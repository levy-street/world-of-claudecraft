"""The Glacier Splinter's bake surfaces: faceted glacier ice lit from within by the
core (deep blue in the thick, pale at the facet edges, rime on top, fracture
lines), and the Smith's rune-iron with its burning blue runes."""
import numpy as np

import anatomy as A
from surface import NT, cavity, frost, srgb

KINDS = ('ice', 'runeiron')
GLOWS = {'glow_core': ((0.45, 0.8, 1.0), 9.0, 'SplinterCoreLight')}
EMIT_STRENGTH = 4.0


def uv_boost(obj, c):
    if obj.get('mat') == 'runeiron':
        return 1.2
    return 0.85


def shade(mat, k):
    t = NT(mat)
    if k == 'ice':
        # depth: the nearer a face is to the core axis, the deeper and bluer (and lit)
        dx = t.px
        dy = t.math('SUBTRACT', t.py, 0.05)
        r = t.math('SQRT', t.math('ADD', t.math('MULTIPLY', dx, dx), t.math('MULTIPLY', dy, dy)))
        inner = t.smooth(r, 0.75, 0.25)
        mott = t.noise(scale=3.0, detail=4)
        base = t.ramp(mott, [(0.25, srgb((0.3, 0.55, 0.74))), (0.75, srgb((0.55, 0.78, 0.92)))])
        deep = t.ramp(t.noise(scale=1.6, detail=3, w=3.0), [(0.3, srgb((0.06, 0.2, 0.42))), (0.7, srgb((0.12, 0.32, 0.56)))])
        color = t.mix(t.math('MULTIPLY', inner, 0.7), base, deep)
        # facet edges catch the light pale (pointiness picks the crisp edges)
        edge = t.smooth(t.point, 0.52, 0.6)
        color = t.mix(t.math('MULTIPLY', edge, 0.8), color, srgb((0.86, 0.95, 1.0)))
        # fractures: bright planes through the ice
        fr = t.smooth(t.voronoi(t.scale_vec(1.0, 1.0, 0.7), scale=4.0, feature='DISTANCE_TO_EDGE'), 0.025, 0.0)
        fr2 = t.smooth(t.voronoi(scale=11.0, feature='DISTANCE_TO_EDGE'), 0.015, 0.0)
        color = t.mix(t.math('MULTIPLY', fr, 0.75), color, srgb((0.9, 0.97, 1.0)))
        color = t.mix(t.math('MULTIPLY', fr2, 0.35), color, srgb((0.75, 0.9, 1.0)))
        # trapped bubbles and old grit (the glacier's age)
        bub = t.smooth(t.voronoi(scale=36, feature='F1'), 0.07, 0.03)
        color = t.mix(t.math('MULTIPLY', bub, 0.35), color, srgb((0.82, 0.92, 0.98)))
        grit = t.smooth(t.noise(t.scale_vec(1, 1, 6), scale=2.0, detail=3), 0.66, 0.72)
        color = t.mix(t.math('MULTIPLY', grit, 0.45), color, srgb((0.18, 0.2, 0.24)))
        rough = t.fmix(edge, 0.12, 0.3)
        h = t.math('ADD', t.math('MULTIPLY', fr, -0.6), t.math('MULTIPLY', t.noise(scale=20, detail=2), 0.25))
        color, rough, h = frost(t, color, rough, h, amount=1.1)
        # lit from within: the core's blue light through the deep faces and along the cracks
        glow = t.math('ADD', t.math('MULTIPLY', inner, 0.22), t.math('MULTIPLY', t.math('MULTIPLY', fr, inner), 0.6))
        emit = t.mix(glow, (0, 0, 0, 1), srgb((0.3, 0.68, 1.0)))
        t.finish(color, rough, 0.0, t.bump(h, 0.25, 0.006), emit=emit)
    elif k == 'runeiron':
        base = t.ramp(t.noise(scale=4, detail=5), [(0.3, srgb((0.12, 0.13, 0.15))), (0.7, srgb((0.24, 0.25, 0.28)))])
        pit = t.smooth(t.noise(scale=30, detail=3), 0.6, 0.7)
        base = t.mix(t.math('MULTIPLY', pit, 0.5), base, srgb((0.06, 0.06, 0.07)))
        wear = t.smooth(t.point, 0.53, 0.6)
        color = t.mix(t.math('MULTIPLY', wear, 0.7), base, srgb((0.5, 0.52, 0.56)))
        color = cavity(t, color, dark=0.5, light=1.12)
        # the runes: lit strokes cut into the iron (bands of glyphs round the rods and
        # the heart block's face)
        gl = t.math('MULTIPLY', t.smooth(t.math('SINE', t.math('MULTIPLY', t.pz, 26.0)), 0.93, 0.99),
                    t.smooth(t.noise(t.scale_vec(10, 10, 2), scale=1.0, detail=2), 0.45, 0.6))
        dx = t.math('ABSOLUTE', t.px)
        face = t.math('MULTIPLY', t.math('MULTIPLY', t.smooth(t.py, -0.36, -0.42), t.smooth(dx, 0.3, 0.26)),
                      t.math('MULTIPLY', t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.pz, float(A.CORE_C[2]))), 0.3, 0.26),
                                     t.smooth(t.math('ABSOLUTE', t.math('SINE', t.math('MULTIPLY', t.px, 40.0))), 0.6, 0.9)))
        rune = t.math('MAXIMUM', gl, face)
        color = t.mix(rune, color, srgb((0.45, 0.8, 1.0)))
        emit = t.mix(rune, (0, 0, 0, 1), srgb((0.35, 0.72, 1.0)))
        rough = t.fmix(wear, 0.55, 0.3)
        metal = t.fmix(rune, 0.85, 0.0)
        h = t.math('SUBTRACT', t.math('MULTIPLY', t.noise(scale=40, detail=3), 0.3), t.math('MULTIPLY', rune, 0.6))
        color, rough, h = frost(t, color, rough, h, amount=0.6)
        t.finish(color, rough, metal, t.bump(h, 0.3, 0.004), emit=emit)
    else:
        raise ValueError(k)
    return mat
