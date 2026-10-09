"""The Scaleguard's bake surfaces: meltwater-dark scales with a pale scuted belly and
the cinder glow in its throat and mouth, the finned crest, the Smith's iron, wet
leather and cloth, the halberd and ice."""
import numpy as np

from surface import NT, cavity, frost, srgb

KINDS = ('scales', 'iron', 'leather', 'cloth', 'steel', 'ice')
GLOWS = {'glow_eye': ((0.62, 0.95, 0.66), 7.0, 'ScaleguardEyes')}
EMIT_STRENGTH = 5.0


def uv_boost(obj, c):
    m = obj.get('mat')
    c = np.asarray(c)
    if obj.name.startswith('Head'):
        return 2.0
    if obj.name.endswith('Claw'):
        return 1.3
    if m == 'steel':
        return 1.1
    if m == 'ice':
        return 0.6
    if c[2] < 0.6:
        return 0.75
    return 1.0


def _iron(t, a, b, frost_amt=1.0):
    base = t.ramp(t.noise(scale=2.4, detail=5), [(0.3, srgb(a)), (0.7, srgb(b))])
    rust = t.math('MAXIMUM', t.smooth(t.noise(scale=4.0, detail=6, rough=0.7), 0.56, 0.68), t.smooth(t.point, 0.48, 0.43))
    rust_c = t.ramp(t.noise(scale=14, detail=3), [(0.3, srgb((0.2, 0.1, 0.06))), (0.7, srgb((0.4, 0.2, 0.09)))])
    color = t.mix(t.math('MULTIPLY', rust, 0.75), base, rust_c)
    wear = t.smooth(t.point, 0.53, 0.6)
    color = t.mix(t.math('MULTIPLY', wear, t.math('SUBTRACT', 1.0, rust)), color, srgb((0.6, 0.62, 0.64)))
    color = cavity(t, color, dark=0.5, light=1.12)
    rough = t.fmix(rust, 0.4, 0.85)
    metal = t.fmix(rust, 0.45, 0.1)
    h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=40, detail=4), rust), t.math('MULTIPLY', rust, 0.5))
    color, rough, h = frost(t, color, rough, h, amount=1.1 * frost_amt)
    return color, rough, metal, h


def shade(mat, k):
    t = NT(mat)
    if k == 'scales':
        # scale plates: voronoi cells, ridged, darker in the seams
        v = t.scale_vec(1.0, 1.0, 1.25)
        cell = t.voronoi(v, scale=24.0, feature='F1')
        edge = t.voronoi(v, scale=24.0, feature='DISTANCE_TO_EDGE')
        seam = t.smooth(edge, 0.06, 0.0)
        base = t.ramp(t.noise(scale=2.2, detail=4), [(0.3, srgb((0.15, 0.22, 0.23))), (0.7, srgb((0.26, 0.34, 0.34)))])
        # a paler, greener cast on the flanks and a near-black back
        back = t.smooth(t.ny, 0.1, 0.7)
        base = t.mix(t.math('MULTIPLY', back, 0.5), base, srgb((0.08, 0.11, 0.13)))
        tint = t.smooth(t.noise(scale=1.3, detail=3, w=2.0), 0.5, 0.7)
        base = t.mix(t.math('MULTIPLY', tint, 0.5), base, srgb((0.24, 0.36, 0.33)))
        # the scuted belly: pale horizontal plates down the front of the torso and the throat
        ax_ = t.math('ABSOLUTE', t.px)
        front = t.math('MULTIPLY', t.smooth(t.ny, -0.15, -0.5), t.smooth(ax_, 0.3, 0.2))
        bel = t.math('MULTIPLY', front, t.math('MULTIPLY', t.smooth(t.pz, 2.05, 2.2), t.smooth(t.pz, 3.95, 3.8)))
        band = t.smooth(t.math('SINE', t.math('MULTIPLY', t.pz, 38.0)), 0.75, 0.95)
        scute_c = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.55, 0.58, 0.52))), (0.7, srgb((0.7, 0.72, 0.65)))])
        scute_c = t.mix(t.math('MULTIPLY', band, 0.8), scute_c, srgb((0.18, 0.2, 0.19)))
        color = t.mix(bel, base, scute_c)
        color = t.mix(t.math('MULTIPLY', seam, t.math('SUBTRACT', 1.0, bel)), color, srgb((0.02, 0.03, 0.035)))
        # each scale lit a touch at its centre (a wet bead on it)
        bead = t.math('MULTIPLY', t.smooth(cell, 0.18, 0.05), 0.25)
        color = t.mix(t.math('MULTIPLY', bead, t.math('SUBTRACT', 1.0, bel)), color, srgb((0.22, 0.32, 0.32)))
        # crest webbing (thin and high on the head): dark membrane with pale veins; spine tips ivory
        crest = t.math('MULTIPLY', t.smooth(ax_, 0.035, 0.015), t.smooth(t.pz, 4.06, 4.14))
        vein = t.smooth(t.noise(t.scale_vec(4, 40, 4), scale=1.0, detail=2), 0.6, 0.66)
        mem = t.mix(t.math('MULTIPLY', vein, 0.6), srgb((0.1, 0.16, 0.2)), srgb((0.42, 0.5, 0.5)))
        color = t.mix(crest, color, mem)
        tips = t.smooth(t.point, 0.56, 0.64)
        color = t.mix(t.math('MULTIPLY', tips, 0.8), color, srgb((0.7, 0.66, 0.55)))
        # teeth along the jaws (thin, ivory)
        teeth = t.math('MULTIPLY', t.math('MULTIPLY', t.smooth(t.py, -0.42, -0.47), t.smooth(ax_, 0.115, 0.1)),
                       t.math('MULTIPLY', t.smooth(t.pz, 3.88, 3.895), t.smooth(t.pz, 3.945, 3.93)))
        color = t.mix(teeth, color, srgb((0.78, 0.72, 0.58)))
        # the cinders: the mouth's inside and the gill slits of the throat glow ember
        mouth = t.math('MULTIPLY', t.math('MULTIPLY', t.smooth(t.py, -0.4, -0.48), t.smooth(ax_, 0.09, 0.06)),
                       t.math('MULTIPLY', t.smooth(t.pz, 3.89, 3.905), t.smooth(t.pz, 3.94, 3.925)))
        slits = t.smooth(t.math('SINE', t.math('MULTIPLY', t.pz, 70.0)), 0.7, 0.9)
        gill = t.math('MULTIPLY', t.math('MULTIPLY', t.smooth(ax_, 0.07, 0.11), t.smooth(ax_, 0.2, 0.16)),
                      t.math('MULTIPLY', t.math('MULTIPLY', t.smooth(t.pz, 3.5, 3.56), t.smooth(t.pz, 3.82, 3.76)),
                                     t.smooth(t.py, 0.0, -0.1)))
        gill = t.math('MULTIPLY', gill, slits)
        ember = t.math('MAXIMUM', mouth, gill)
        color = t.mix(ember, color, srgb((0.9, 0.45, 0.12)))
        emit = t.mix(ember, (0, 0, 0, 1), srgb((1.0, 0.5, 0.12)))
        color = cavity(t, color, dark=0.6, light=1.08)
        # wet: meltwater runs down it in glossy streaks
        streak = t.smooth(t.noise(t.scale_vec(7, 7, 0.6), scale=1.0, detail=3), 0.52, 0.66)
        rough = t.fmix(streak, 0.5, 0.18)
        rough = t.fmix(bel, rough, 0.55)
        color = t.mix(t.math('MULTIPLY', streak, 0.25), color, srgb((0.03, 0.05, 0.06)))
        h = t.math('ADD', t.math('MULTIPLY', t.smooth(cell, 0.3, 0.0), 0.6), t.math('MULTIPLY', seam, -0.9))
        h = t.fmix(bel, h, t.math('MULTIPLY', band, -0.8))
        color, rough, h = frost(t, color, rough, h, amount=0.75, z_min=3.4)
        t.finish(color, rough, 0.0, t.bump(h, 0.4, 0.006), emit=emit)
    elif k == 'iron':
        color, rough, metal, h = _iron(t, (0.34, 0.35, 0.37), (0.48, 0.49, 0.5))
        t.finish(color, rough, metal, t.bump(h, 0.3, 0.006))
    elif k == 'leather':
        base = t.ramp(t.noise(scale=4, detail=5), [(0.35, srgb((0.09, 0.07, 0.06))), (0.65, srgb((0.18, 0.13, 0.1)))])
        scuff = t.smooth(t.noise(t.scale_vec(5, 5, 26), scale=1.0, detail=3), 0.6, 0.68)
        base = t.mix(t.math('MULTIPLY', scuff, 0.6), base, srgb((0.3, 0.24, 0.2)))
        color = cavity(t, base, dark=0.5, light=1.15)
        rough = t.math('ADD', 0.4, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.2))
        h = t.math('MULTIPLY', scuff, 0.4)
        color, rough, h = frost(t, color, rough, h, amount=0.7)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'cloth':
        weave = t.noise(t.scale_vec(150, 150, 150), scale=1.0, detail=2)
        base = t.ramp(t.noise(scale=2.5, detail=4), [(0.3, srgb((0.1, 0.13, 0.12))), (0.7, srgb((0.18, 0.22, 0.2)))])
        rot_ = t.smooth(t.noise(scale=3, detail=4), 0.55, 0.72)
        base = t.mix(t.math('MULTIPLY', rot_, 0.5), base, srgb((0.05, 0.06, 0.05)))
        glaze = t.math('MULTIPLY', t.smooth(t.pz, 1.5, 1.15), 0.7)
        base = t.mix(glaze, base, srgb((0.6, 0.74, 0.8)))
        color = cavity(t, base, dark=0.55, light=1.1)
        rough = t.fmix(glaze, 0.85, 0.15)
        h = t.math('ADD', t.math('MULTIPLY', weave, 0.4), t.math('MULTIPLY', t.noise(scale=6, detail=3), 0.6))
        color, rough, h = frost(t, color, rough, h, amount=0.8)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'steel':
        color, rough, metal, h = _iron(t, (0.4, 0.42, 0.45), (0.55, 0.57, 0.6), frost_amt=0.6)
        wood = t.node('ShaderNodeAttribute')
        wood.attribute_name = 'RegWood'
        wm = t.smooth(wood.outputs['Fac'], 0.2, 0.8)
        grain = t.noise(t.scale_vec(30, 30, 1.5), scale=1.0, detail=4, dist=1.5)
        wood_c = t.ramp(grain, [(0.3, srgb((0.12, 0.08, 0.05))), (0.7, srgb((0.26, 0.17, 0.1)))])
        color = t.mix(wm, color, wood_c)
        rough = t.fmix(wm, rough, 0.7)
        metal = t.fmix(wm, metal, 0.0)
        h = t.fmix(wm, h, t.math('MULTIPLY', grain, 0.6))
        t.finish(color, rough, metal, t.bump(h, 0.3, 0.004))
    elif k == 'ice':
        base = t.ramp(t.noise(scale=12, detail=3), [(0.3, srgb((0.6, 0.78, 0.9))), (0.7, srgb((0.86, 0.94, 0.99)))])
        core = t.smooth(t.point, 0.5, 0.44)
        color = t.mix(t.math('MULTIPLY', core, 0.6), base, srgb((0.32, 0.56, 0.78)))
        emit = t.mix(0.5, (0, 0, 0, 1), srgb((0.08, 0.16, 0.24)))
        t.finish(color, 0.08, 0.0, t.bump(t.noise(scale=60), 0.15, 0.003), emit=emit)
    else:
        raise ValueError(k)
    return mat
