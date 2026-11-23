"""The Sledge-Hauler's bake surfaces: cold-bitten mountain-ogre hide, shaggy fur,
frozen harness leather, old iron, ice, and its small rheumy eyes."""
import numpy as np

from surface import NT, cavity, frost, srgb

KINDS = ('skin', 'fur', 'leather', 'iron', 'ice', 'eye')
GLOWS = {}
EMIT_STRENGTH = 2.0


def uv_boost(obj, c):
    m = obj.get('mat')
    c = np.asarray(c)
    if obj.name.startswith('Head'):
        return 2.0
    if obj.name.endswith('Fist'):
        return 1.3
    if m == 'eye':
        return 1.5
    if m == 'ice':
        return 0.5
    if m == 'fur':
        return 0.8
    if obj.get('separate'):
        return 0.6
    return 1.0


def shade(mat, k):
    t = NT(mat)
    if k == 'skin':
        # grey mountain hide, blue-violet where the cold has it, frostbite black at the
        # extremities, chapped and scarred; a few dark-green old tattoos of the clan
        mott = t.noise(scale=1.4, detail=4)
        base = t.ramp(mott, [(0.3, srgb((0.33, 0.36, 0.38))), (0.7, srgb((0.46, 0.48, 0.48)))])
        cold = t.smooth(t.noise(scale=2.2, detail=3, w=1.0), 0.48, 0.7)
        base = t.mix(t.math('MULTIPLY', cold, 0.55), base, srgb((0.32, 0.33, 0.45)))
        warm = t.smooth(t.point, 0.47, 0.42)
        base = t.mix(t.math('MULTIPLY', warm, 0.35), base, srgb((0.45, 0.3, 0.3)))
        bite = t.math('MULTIPLY', t.smooth(t.point, 0.535, 0.6), t.smooth(t.noise(scale=6, detail=3), 0.35, 0.55))
        base = t.mix(t.math('MULTIPLY', bite, 0.85), base, srgb((0.09, 0.07, 0.12)))
        # the extremities (hands, fingers): frostbitten dark at the tips
        ax = t.math('ABSOLUTE', t.px)
        hands = t.math('MULTIPLY', t.smooth(ax, 1.9, 2.15), t.smooth(t.pz, 2.2, 1.9))
        base = t.mix(t.math('MULTIPLY', hands, 0.55), base, srgb((0.14, 0.12, 0.2)))
        pores = t.smooth(t.voronoi(scale=40), 0.07, 0.02)
        base = t.mix(t.math('MULTIPLY', pores, 0.15), base, srgb((0.22, 0.22, 0.26)))
        # clan tattoos: bands round the upper arms and lines over the chest
        tat = t.math('MULTIPLY', t.smooth(t.math('SINE', t.math('MULTIPLY', t.pz, 14.0)), 0.92, 0.98),
                     t.math('MULTIPLY', t.smooth(ax, 1.1, 1.25), t.smooth(ax, 1.6, 1.5)))
        tat = t.math('MULTIPLY', tat, t.math('MULTIPLY', t.smooth(t.pz, 3.6, 3.75), t.smooth(t.pz, 4.25, 4.1)))
        base = t.mix(t.math('MULTIPLY', tat, 0.7), base, srgb((0.12, 0.2, 0.2)))
        color = cavity(t, base, dark=0.65, light=1.06)
        chap = t.smooth(t.voronoi(scale=22, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        color = t.mix(t.math('MULTIPLY', chap, 0.35), color, srgb((0.2, 0.18, 0.22)))
        rough = t.math('ADD', 0.58, t.math('MULTIPLY', t.noise(scale=6, detail=2), 0.15))
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=70, detail=2), 0.25), t.math('MULTIPLY', chap, -0.6))
        color, rough, h = frost(t, color, rough, h, amount=0.55, z_min=3.8)
        t.finish(color, rough, 0.0, t.bump(h, 0.35, 0.01))
    elif k == 'fur':
        # long shaggy grey-brown yak fur, white with rime on top, matted dark below
        strands = t.noise(t.scale_vec(28, 28, 3.5), scale=1.0, detail=4, dist=0.6)
        clump = t.noise(t.scale_vec(6, 6, 1.5), scale=1.0, detail=3)
        base = t.ramp(t.math('ADD', t.math('MULTIPLY', strands, 0.6), t.math('MULTIPLY', clump, 0.4)),
                      [(0.3, srgb((0.18, 0.15, 0.12))), (0.55, srgb((0.38, 0.33, 0.27))), (0.75, srgb((0.62, 0.58, 0.5)))])
        dark = t.smooth(t.point, 0.48, 0.42)
        base = t.mix(t.math('MULTIPLY', dark, 0.8), base, srgb((0.06, 0.05, 0.04)))
        under = t.smooth(t.nz, -0.1, -0.6)
        base = t.mix(t.math('MULTIPLY', under, 0.6), base, srgb((0.1, 0.08, 0.06)))
        color = base
        rough = 0.85
        h = t.math('ADD', t.math('MULTIPLY', strands, 1.2), t.math('MULTIPLY', clump, 0.6))
        color, rough, h = frost(t, color, rough, h, amount=1.2)
        t.finish(color, rough, 0.0, t.bump(h, 0.6, 0.012))
    elif k == 'leather':
        base = t.ramp(t.noise(scale=4, detail=5), [(0.35, srgb((0.12, 0.08, 0.05))), (0.65, srgb((0.26, 0.17, 0.1)))])
        scuff = t.smooth(t.noise(t.scale_vec(5, 5, 26), scale=1.0, detail=3), 0.6, 0.68)
        base = t.mix(t.math('MULTIPLY', scuff, 0.6), base, srgb((0.4, 0.3, 0.22)))
        stitch = t.smooth(t.math('SINE', t.math('MULTIPLY', t.math('ADD', t.px, t.py), 60.0)), 0.9, 0.98)
        crack = t.smooth(t.voronoi(scale=26, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', crack, 0.5), base, srgb((0.06, 0.04, 0.03)))
        color = cavity(t, base, dark=0.5, light=1.15)
        color = t.mix(t.math('MULTIPLY', stitch, 0.25), color, srgb((0.45, 0.4, 0.32)))
        rough = t.math('ADD', 0.5, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.2))
        metal = 0.0
        # the iron rings on the harness
        ring = t.smooth(t.point, 0.52, 0.58)
        h = t.math('SUBTRACT', t.math('MULTIPLY', scuff, 0.4), t.math('MULTIPLY', crack, 0.8))
        color, rough, h = frost(t, color, rough, h, amount=0.9)
        t.finish(color, rough, metal, t.bump(h, 0.3, 0.006))
    elif k == 'iron':
        base = t.ramp(t.noise(scale=3, detail=5), [(0.3, srgb((0.16, 0.16, 0.17))), (0.7, srgb((0.3, 0.3, 0.31)))])
        rust = t.math('MAXIMUM', t.smooth(t.noise(scale=4, detail=6, rough=0.7), 0.52, 0.66), t.smooth(t.point, 0.48, 0.43))
        rust_c = t.ramp(t.noise(scale=14, detail=3), [(0.3, srgb((0.22, 0.1, 0.05))), (0.7, srgb((0.45, 0.22, 0.09)))])
        color = t.mix(t.math('MULTIPLY', rust, 0.8), base, rust_c)
        wear = t.smooth(t.point, 0.53, 0.6)
        color = t.mix(t.math('MULTIPLY', wear, 0.6), color, srgb((0.55, 0.55, 0.56)))
        rough = t.fmix(rust, 0.42, 0.88)
        metal = t.fmix(rust, 0.6, 0.1)
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=40, detail=4), rust), t.math('MULTIPLY', rust, 0.5))
        color, rough, h = frost(t, color, rough, h, amount=1.0)
        t.finish(color, rough, metal, t.bump(h, 0.25, 0.005))
    elif k == 'ice':
        base = t.ramp(t.noise(scale=8, detail=3), [(0.3, srgb((0.58, 0.77, 0.9))), (0.7, srgb((0.86, 0.94, 0.99)))])
        core = t.smooth(t.point, 0.5, 0.44)
        color = t.mix(t.math('MULTIPLY', core, 0.6), base, srgb((0.3, 0.55, 0.78)))
        fr = t.smooth(t.voronoi(scale=6, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        color = t.mix(t.math('MULTIPLY', fr, 0.6), color, srgb((0.95, 0.98, 1.0)))
        emit = t.mix(0.5, (0, 0, 0, 1), srgb((0.06, 0.13, 0.2)))
        t.finish(color, 0.1, 0.0, t.bump(t.noise(scale=40), 0.2, 0.004), emit=emit)
    elif k == 'eye':
        base = t.ramp(t.noise(scale=60, detail=2), [(0.3, srgb((0.55, 0.52, 0.38))), (0.7, srgb((0.7, 0.66, 0.5)))])
        t.finish(base, 0.12, 0.0)
    else:
        raise ValueError(k)
    return mat
