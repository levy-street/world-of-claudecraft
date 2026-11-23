"""The Boneguard's bake surfaces: corpse flesh, old frosted plate, mail, the frozen
tabard, frozen leather, the sword's steel with its rune, and ice."""
import numpy as np

import anatomy as A
from surface import NT, cavity, frost, srgb

KINDS = ('flesh', 'plate', 'gauntlet', 'mail', 'cloth', 'leather', 'steel', 'ice')
GLOWS = {'glow_eye': ((0.62, 0.86, 1.0), 7.0, 'BoneguardEyes')}
EMIT_STRENGTH = 4.0


def uv_boost(obj, c):
    m = obj.get('mat')
    c = np.asarray(c)
    if m == 'flesh' and c[2] > 3.85:
        return 2.4
    if m == 'flesh':
        return 1.4
    if m == 'steel':
        return 1.3
    if obj.name.startswith('Helm') or obj.name.startswith('Cuirass'):
        return 1.15
    if m == 'ice':
        return 0.6
    if c[2] < 0.5:
        return 0.7
    return {'mail': 0.75, 'cloth': 0.9, 'leather': 0.7, 'gauntlet': 1.1}.get(m, 1.0)


def _plate(t, base_a, base_b, frost_amt=1.0):
    mott = t.noise(scale=2.4, detail=5, rough=0.6)
    base = t.ramp(mott, [(0.3, srgb(base_a)), (0.7, srgb(base_b))])
    # tarnish blooms and old blood-dark rust in the pits
    pit = t.smooth(t.noise(scale=26, detail=3), 0.62, 0.7)
    rust = t.math('MAXIMUM', t.smooth(t.noise(scale=4.2, detail=6, rough=0.7), 0.6, 0.72), t.smooth(t.point, 0.48, 0.43))
    rust_c = t.ramp(t.noise(scale=14, detail=3), [(0.3, srgb((0.17, 0.11, 0.09))), (0.7, srgb((0.3, 0.2, 0.15)))])
    color = t.mix(t.math('MULTIPLY', rust, 0.7), base, rust_c)
    color = t.mix(t.math('MULTIPLY', pit, 0.5), color, srgb((0.12, 0.13, 0.15)))
    wear = t.smooth(t.point, 0.53, 0.6)
    color = t.mix(t.math('MULTIPLY', wear, t.math('SUBTRACT', 1.0, rust)), color, srgb((0.62, 0.66, 0.7)))
    color = cavity(t, color, dark=0.5, light=1.12)
    rough = t.fmix(rust, 0.46, 0.85)
    rough = t.fmix(t.math('MULTIPLY', wear, 0.8), rough, 0.3)
    metal = t.fmix(rust, 0.4, 0.1)
    h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=40, detail=4), rust), t.math('MULTIPLY', pit, -0.6))
    # frost cracks: hairline lines glazed white
    crack = t.math('MULTIPLY', t.smooth(t.voronoi(scale=11, feature='DISTANCE_TO_EDGE'), 0.018, 0.0),
                   t.smooth(t.noise(scale=3, detail=2), 0.55, 0.62))
    color = t.mix(t.math('MULTIPLY', crack, 0.35), color, srgb((0.8, 0.88, 0.94)))
    color, rough, h = frost(t, color, rough, h, amount=1.5 * frost_amt)
    hoar = t.math('MULTIPLY', t.smooth(t.noise(scale=5, detail=4, w=7.0), 0.5, 0.62), 0.45 * frost_amt)
    color = t.mix(hoar, color, srgb((0.78, 0.85, 0.9)))
    rough = t.fmix(hoar, rough, 0.6)
    # ice-blue rime in the hollows (the Quench is still in the metal)
    cold = t.math('MULTIPLY', t.smooth(t.point, 0.49, 0.44), 0.5)
    color = t.mix(cold, color, srgb((0.55, 0.72, 0.84)))
    metal = t.math('MULTIPLY', metal, t.math('SUBTRACT', 1.0, t.math('MULTIPLY', t.smooth(t.nz, 0.3, 0.8), 0.55)))
    return color, rough, metal, h


def shade(mat, k):
    t = NT(mat)
    if k == 'flesh':
        # corpse-grey with a cold blue cast, livid violet veins, frostbite black at the
        # extremities (the nose, the brow, the finger ends), rime in the hollows
        mott = t.noise(scale=3.5, detail=4, rough=0.55)
        base = t.ramp(mott, [(0.3, srgb((0.5, 0.53, 0.56))), (0.7, srgb((0.64, 0.66, 0.68)))])
        livid = t.smooth(t.noise(scale=6, detail=3, w=3.0), 0.52, 0.72)
        base = t.mix(t.math('MULTIPLY', livid, 0.5), base, srgb((0.44, 0.44, 0.58)))
        vein = t.smooth(t.noise(t.scale_vec(30, 30, 8), scale=1.0, detail=2, dist=1.5), 0.62, 0.66)
        base = t.mix(t.math('MULTIPLY', vein, 0.45), base, srgb((0.32, 0.28, 0.42)))
        # frostbite: the tips (pointiness picks the nose, the brow ridge, finger ends)
        bite = t.math('MULTIPLY', t.smooth(t.point, 0.54, 0.6), t.smooth(t.noise(scale=12, detail=3), 0.4, 0.6))
        base = t.mix(t.math('MULTIPLY', bite, 0.75), base, srgb((0.16, 0.15, 0.2)))
        sock = t.smooth(t.point, 0.46, 0.4)
        base = t.mix(t.math('MULTIPLY', sock, 0.7), base, srgb((0.18, 0.19, 0.26)))
        # frozen beard stubble on the jaw and the chin
        jaw = t.math('MULTIPLY', t.smooth(t.pz, 4.1, 4.04), t.smooth(t.py, -0.08, -0.16))
        stub = t.smooth(t.noise(scale=180, detail=1), 0.45, 0.62)
        base = t.mix(t.math('MULTIPLY', t.math('MULTIPLY', jaw, stub), 0.85), base, srgb((0.82, 0.86, 0.9)))
        color = cavity(t, base, dark=0.6, light=1.06)
        rough = t.math('ADD', 0.5, t.math('MULTIPLY', t.noise(scale=8, detail=2), 0.15))
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=120, detail=2), 0.25), t.math('MULTIPLY', vein, 0.4))
        cr = t.smooth(t.voronoi(scale=16, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        color = t.mix(t.math('MULTIPLY', cr, 0.4), color, srgb((0.25, 0.25, 0.32)))
        h = t.math('SUBTRACT', h, t.math('MULTIPLY', cr, 0.5))
        color, rough, h = frost(t, color, rough, h, amount=0.7)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k in ('plate', 'gauntlet'):
        color, rough, metal, h = _plate(t, (0.4, 0.44, 0.48), (0.56, 0.6, 0.64))
        if k == 'gauntlet':
            # articulated lames across the fingers and the back of the hand
            lames = t.smooth(t.math('SINE', t.math('MULTIPLY', t.math('ADD', t.px, t.pz), 95.0)), 0.85, 0.98)
            color = t.mix(t.math('MULTIPLY', lames, 0.6), color, srgb((0.1, 0.1, 0.11)))
            h = t.math('SUBTRACT', h, t.math('MULTIPLY', lames, 0.8))
        t.finish(color, rough, metal, t.bump(h, 0.3, 0.006))
    elif k == 'mail':
        v = t.scale_vec(34, 34, 48)
        ring = t.voronoi(v, scale=1.0, feature='F1')
        hole = t.smooth(ring, 0.22, 0.12)
        link = t.math('MULTIPLY', t.smooth(ring, 0.12, 0.2), t.smooth(ring, 0.45, 0.33))
        base = t.ramp(t.noise(scale=3, detail=4), [(0.3, srgb((0.3, 0.32, 0.35))), (0.7, srgb((0.46, 0.48, 0.5)))])
        rust = t.smooth(t.noise(scale=5, detail=6, rough=0.7), 0.58, 0.7)
        base = t.mix(t.math('MULTIPLY', rust, 0.7), base, srgb((0.26, 0.16, 0.11)))
        color = t.mix(hole, base, srgb((0.04, 0.04, 0.05)))
        color = t.mix(t.math('MULTIPLY', link, 0.35), color, srgb((0.55, 0.58, 0.62)))
        color = cavity(t, color, dark=0.5, light=1.1)
        rough = t.fmix(rust, 0.42, 0.85)
        metal = t.fmix(t.math('MAXIMUM', hole, rust), 0.85, 0.1)
        h = t.math('ADD', t.math('MULTIPLY', link, 0.7), t.math('MULTIPLY', hole, -0.6))
        color, rough, h = frost(t, color, rough, h, amount=0.9)
        t.finish(color, rough, metal, t.bump(h, 0.45, 0.005))
    elif k == 'cloth':
        # the Smith's tabard, faded slate blue, the hammer-and-anvil in pale thread,
        # stiff with ice: glaze at the hem, frost in the folds
        weave = t.noise(t.scale_vec(160, 160, 160), scale=1.0, detail=2)
        base = t.ramp(t.noise(scale=2.5, detail=4), [(0.3, srgb((0.12, 0.15, 0.2))), (0.7, srgb((0.2, 0.24, 0.3)))])
        fade = t.smooth(t.noise(scale=1.2, detail=3), 0.5, 0.72)
        base = t.mix(t.math('MULTIPLY', fade, 0.5), base, srgb((0.34, 0.37, 0.42)))
        # the emblem (front panel, chest height of the hanging tabard)
        ex = t.math('ABSOLUTE', t.px)
        front = t.smooth(t.py, -0.3, -0.38)
        def box(x0, z0, z1):
            return t.math('MULTIPLY', t.smooth(ex, x0 + 0.012, x0), t.math('MULTIPLY', t.smooth(t.pz, z0, z0 + 0.012),
                                                                          t.smooth(t.pz, z1, z1 - 0.012)))
        hammer = t.math('MAXIMUM', box(0.03, 2.1, 2.42), box(0.13, 2.34, 2.45))
        anvil = t.math('MAXIMUM', t.math('MAXIMUM', box(0.21, 1.98, 2.05), box(0.07, 1.88, 1.99)), box(0.15, 1.82, 1.89))
        ring = t.math('MULTIPLY', t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('SQRT', t.math('ADD',
                       t.math('MULTIPLY', t.px, t.px), t.math('MULTIPLY', t.math('SUBTRACT', t.pz, 2.13),
                                                               t.math('SUBTRACT', t.pz, 2.13)))), 0.36)), 0.02, 0.008), 1.0)
        emb = t.math('MULTIPLY', t.math('MAXIMUM', t.math('MAXIMUM', hammer, anvil), ring), front)
        base = t.mix(t.math('MULTIPLY', emb, 0.8), base, srgb((0.62, 0.6, 0.52)))
        dirt = t.smooth(t.pz, 1.5, 1.05)
        base = t.mix(t.math('MULTIPLY', dirt, 0.5), base, srgb((0.1, 0.1, 0.12)))
        color = cavity(t, base, dark=0.55, light=1.1)
        color = t.mix(t.math('MULTIPLY', weave, 0.15), color, srgb((0.4, 0.42, 0.46)))
        rough = t.fmix(dirt, 0.92, 0.5)
        glaze = t.math('MULTIPLY', t.smooth(t.pz, 1.45, 1.1), 0.75)
        color = t.mix(glaze, color, srgb((0.68, 0.8, 0.88)))
        rough = t.fmix(glaze, rough, 0.12)
        h = t.math('ADD', t.math('MULTIPLY', weave, 0.4), t.math('MULTIPLY', t.noise(scale=6, detail=3), 0.6))
        color, rough, h = frost(t, color, rough, h, amount=0.9)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'leather':
        base = t.ramp(t.noise(scale=4, detail=5), [(0.35, srgb((0.12, 0.08, 0.06))), (0.65, srgb((0.24, 0.16, 0.1)))])
        scuff = t.smooth(t.noise(t.scale_vec(5, 5, 26), scale=1.0, detail=3), 0.6, 0.68)
        base = t.mix(t.math('MULTIPLY', scuff, 0.6), base, srgb((0.36, 0.28, 0.22)))
        crack = t.smooth(t.voronoi(scale=30, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', crack, 0.5), base, srgb((0.06, 0.04, 0.03)))
        color = cavity(t, base, dark=0.5, light=1.15)
        rough = t.math('ADD', 0.55, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.2))
        h = t.math('SUBTRACT', t.math('MULTIPLY', scuff, 0.4), t.math('MULTIPLY', crack, 0.8))
        color, rough, h = frost(t, color, rough, h, amount=0.8)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'steel':
        color, rough, metal, h = _plate(t, (0.62, 0.65, 0.68), (0.78, 0.8, 0.83), frost_amt=0.5)
        rune = t.node('ShaderNodeAttribute')
        rune.attribute_name = 'RegRune'
        rm = t.smooth(rune.outputs['Fac'], 0.1, 0.6)
        color = t.mix(rm, color, srgb((0.45, 0.75, 1.0)))
        emit = t.mix(rm, (0, 0, 0, 1), srgb((0.35, 0.72, 1.0)))
        h = t.math('SUBTRACT', h, t.math('MULTIPLY', rm, 0.8))
        t.finish(color, rough, metal, t.bump(h, 0.3, 0.004), emit=emit)
    elif k == 'ice':
        base = t.ramp(t.noise(scale=12, detail=3), [(0.3, srgb((0.6, 0.78, 0.9))), (0.7, srgb((0.86, 0.94, 0.99)))])
        core = t.smooth(t.point, 0.5, 0.44)
        color = t.mix(t.math('MULTIPLY', core, 0.6), base, srgb((0.32, 0.56, 0.78)))
        emit = t.mix(0.5, (0, 0, 0, 1), srgb((0.08, 0.16, 0.24)))
        t.finish(color, 0.08, 0.0, t.bump(t.noise(scale=60), 0.15, 0.003), emit=emit)
    else:
        raise ValueError(k)
    return mat
