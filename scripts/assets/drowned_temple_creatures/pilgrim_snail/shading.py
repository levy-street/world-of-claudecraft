"""The Tide Pilgrim's bake surfaces: wet deep-sea flesh (indigo-teal, turquoise
mottling, a pale pearl sole and skirt rim, cyan light-spots down its flanks), the
turquoise-and-pearl nacre of the shell (polished carved plates, dark seams, glowing
moon glyphs, ivory crown knobs, an iridescent lip), the shrine's white marble, moon
silver and pearls. No rust, no barnacles, no grey."""
import numpy as np

from surface import NT, cavity, srgb

KINDS = ('flesh', 'nacre', 'marble', 'silver', 'pearl', 'pupil')
GLOWS = {
    'glow_eye': ((0.55, 0.95, 1.0), 4.5, 'PilgrimEyes'),
    'glow_pearl': ((0.86, 0.96, 1.0), 7.0, 'PilgrimMoonPearl'),
    'glow_flare': ((0.36, 0.3, 1.0), 1.1, 'PilgrimFrenzyFlare'),
}
EMIT_STRENGTH = 4.0


def uv_boost(obj, c):
    m = obj.get('mat')
    c = np.asarray(c)
    if m == 'flesh':
        if c[1] < -1.3 and c[2] > 0.6:
            return 1.6           # the head and its eyes
        if c[2] < 0.06:
            return 0.45          # the sole nobody sees
        return 1.0
    if m == 'nacre':
        return 1.15
    if m == 'marble':
        return 1.1
    if m == 'silver':
        return 0.9
    if m in ('pearl', 'pupil'):
        return 0.5
    return 1.0


def _attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs['Fac']


def shade(mat, k):
    t = NT(mat)
    if k == 'flesh':
        base = t.ramp(t.noise(scale=1.6, detail=4), [(0.3, srgb((0.035, 0.15, 0.2))), (0.75, srgb((0.07, 0.27, 0.33)))])
        # turquoise mottling: soft cells on the back and the head
        cell = t.voronoi(t.scale_vec(1.0, 1.0, 1.3), scale=5.5, feature='F1')
        mott = t.math('MULTIPLY', t.smooth(cell, 0.42, 0.12), t.smooth(t.nz, -0.2, 0.5))
        base = t.mix(t.math('MULTIPLY', mott, 0.75), base, srgb((0.14, 0.5, 0.52)))
        # a violet blush on the head, the proboscis and the eye stalks
        head = t.math('MULTIPLY', t.smooth(t.py, -1.25, -1.7), t.smooth(t.pz, 0.55, 0.9))
        base = t.mix(t.math('MULTIPLY', head, 0.4), base, srgb((0.26, 0.2, 0.42)))
        # the sole and the skirt's underside: pale pearl
        sole = t.math('MAXIMUM', t.smooth(t.pz, 0.09, 0.02), t.smooth(t.nz, -0.35, -0.8))
        base = t.mix(sole, base, srgb((0.52, 0.62, 0.66)))
        # the skirt rim: a pearl-lilac edge where the frill flares out
        rim = t.math('MULTIPLY', t.smooth(t.pz, 0.08, 0.13), t.smooth(t.pz, 0.27, 0.2))
        ax = t.math('ABSOLUTE', t.px)
        rim = t.math('MULTIPLY', rim, t.smooth(ax, 0.62, 0.78))
        base = t.mix(t.math('MULTIPLY', rim, 0.8), base, srgb((0.62, 0.6, 0.78)))
        # the light spots: rows of small cyan photophores down each flank
        spot_v = t.voronoi(t.scale_vec(1.0, 1.0, 1.0), scale=9.0, feature='F1')
        spots = t.smooth(spot_v, 0.16, 0.08)
        flank = t.math('MULTIPLY', t.smooth(t.pz, 0.16, 0.26), t.smooth(t.pz, 0.62, 0.48))
        flank = t.math('MULTIPLY', flank, t.smooth(ax, 0.38, 0.55))
        flank = t.math('MULTIPLY', flank, t.smooth(t.py, 2.2, 1.9))
        lit = t.math('MULTIPLY', spots, flank)
        # the eye stalks' tips and the feelers' tips go pale
        tips = t.math('MULTIPLY', t.smooth(t.pz, 1.45, 1.75), t.smooth(t.py, -1.5, -1.7))
        base = t.mix(t.math('MULTIPLY', tips, 0.6), base, srgb((0.45, 0.6, 0.66)))
        color = t.mix(lit, base, srgb((0.55, 0.95, 1.0)))
        emit = t.mix(lit, (0, 0, 0, 1), srgb((0.3, 0.9, 1.0)))
        color = cavity(t, color, dark=0.45, light=1.15)
        # wet: glossy streaks, a slick sheen
        streak = t.smooth(t.noise(t.scale_vec(4, 4, 1.2), scale=1.0, detail=3), 0.45, 0.65)
        rough = t.fmix(streak, 0.42, 0.14)
        h = t.math('ADD', t.math('MULTIPLY', t.smooth(cell, 0.4, 0.05), 0.35),
                   t.math('MULTIPLY', t.noise(scale=28, detail=3), 0.4))
        t.finish(color, rough, 0.0, t.bump(h, 0.35, 0.006), emit=emit)
    elif k == 'nacre':
        plate = _attr(t, 'RegPlate')
        glyph = _attr(t, 'RegGlyph')
        seam = _attr(t, 'RegSeam')
        knob = _attr(t, 'RegKnob')
        lip = _attr(t, 'RegLip')
        # the shell between the plates: deep turquoise with pearl spiral bands
        # banding that FOLLOWS the coil (a real snail's colour bands): stripes
        # across the tube's angle, and fine growth lines across the whorl
        psi = _attr(t, 'RegPsi')
        tt = _attr(t, 'RegT')
        wob = t.math('MULTIPLY', t.noise(scale=3.0, detail=2), 0.25)
        stripes = t.math('SINE', t.math('ADD', t.math('MULTIPLY', psi, 5.0), wob))
        band = t.smooth(stripes, 0.15, 0.55)
        growth = t.smooth(t.math('SINE', t.math('MULTIPLY', tt, 460.0)), 0.85, 1.0)
        teal = t.ramp(t.noise(scale=3.0, detail=4), [(0.3, srgb((0.05, 0.3, 0.36))), (0.7, srgb((0.1, 0.46, 0.5)))])
        pearl = t.ramp(t.noise(scale=6.0, detail=3, w=1.0), [(0.25, srgb((0.72, 0.8, 0.84))), (0.5, srgb((0.82, 0.78, 0.9))),
                                                             (0.75, srgb((0.7, 0.88, 0.86)))])
        color = t.mix(t.math('MULTIPLY', band, 0.85), teal, pearl)
        color = t.mix(t.math('MULTIPLY', growth, 0.25), color, srgb((0.03, 0.16, 0.2)))
        # the nacre sheen: a lilac and sea-green play of colour over everything
        sheen = t.ramp(t.noise(scale=2.2, detail=2, w=3.0), [(0.3, srgb((0.86, 0.8, 1.0))), (0.7, srgb((0.8, 1.0, 0.95)))])
        color = t.mix(0.25, color, sheen, 'MULTIPLY')
        # carved plates: polished pearl faces, dark seams
        plate_c = t.ramp(t.noise(scale=9, detail=3), [(0.3, srgb((0.78, 0.84, 0.88))), (0.7, srgb((0.9, 0.9, 0.96)))])
        color = t.mix(plate, color, plate_c)
        color = t.mix(seam, color, srgb((0.03, 0.14, 0.18)))
        # the crown knobs: ivory-pearl, whiter at the tips
        color = t.mix(t.smooth(knob, 0.25, 0.75), color, srgb((0.88, 0.9, 0.92)))
        # the aperture lip and the socket collar: iridescent rose and lilac
        lip_c = t.ramp(t.noise(scale=7, detail=2), [(0.3, srgb((0.92, 0.8, 0.9))), (0.7, srgb((0.78, 0.82, 1.0)))])
        color = t.mix(lip, color, lip_c)
        # the moon glyphs: cut into each plate and lit from within
        color = t.mix(glyph, color, srgb((0.55, 0.98, 1.0)))
        emit = t.mix(glyph, (0, 0, 0, 1), srgb((0.35, 0.95, 1.0)))
        color = cavity(t, color, dark=0.5, light=1.1)
        rough = t.fmix(t.math('MAXIMUM', plate, lip), 0.38, 0.16)
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=40, detail=2), 0.2), t.math('MULTIPLY', band, 0.2))
        t.finish(color, rough, 0.0, t.bump(h, 0.25, 0.004), emit=emit)
    elif k == 'marble':
        vein = t.smooth(t.noise(t.scale_vec(1.0, 1.0, 1.0), scale=3.5, detail=6, dist=2.5), 0.48, 0.52)
        base = t.ramp(t.noise(scale=5, detail=3), [(0.3, srgb((0.8, 0.84, 0.88))), (0.7, srgb((0.9, 0.92, 0.95)))])
        base = t.mix(t.math('MULTIPLY', t.math('SUBTRACT', 1.0, vein), 0.0), base, base)
        vein_l = t.math('SUBTRACT', 1.0, t.math('ABSOLUTE', t.math('SUBTRACT', vein, 0.5)))
        base = t.mix(t.math('MULTIPLY', t.smooth(vein_l, 0.9, 1.0), 0.6), base, srgb((0.42, 0.6, 0.72)))
        color = cavity(t, base, dark=0.55, light=1.06)
        t.finish(color, 0.42, 0.0, t.bump(t.noise(scale=50, detail=2), 0.12, 0.003))
    elif k == 'silver':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.8, 0.84, 0.9))), (0.7, srgb((0.92, 0.94, 0.98)))])
        color = cavity(t, base, dark=0.55, light=1.06)
        rough = t.math('ADD', 0.28, t.math('MULTIPLY', t.noise(scale=12, detail=2), 0.12))
        t.finish(color, rough, 0.55, t.bump(t.noise(scale=80, detail=2), 0.08, 0.002))
    elif k == 'pearl':
        base = t.ramp(t.noise(scale=30, detail=2), [(0.3, srgb((0.9, 0.88, 0.94))), (0.7, srgb((0.86, 0.94, 0.95)))])
        t.finish(base, 0.12, 0.0)
    elif k == 'pupil':
        t.finish(srgb((0.01, 0.02, 0.05)), 0.1, 0.0)
    else:
        raise ValueError(k)
    return mat
