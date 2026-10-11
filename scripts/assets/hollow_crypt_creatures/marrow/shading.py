"""Sexton Marrow's bake surfaces: old bone (ivory gone yellow, grave earth worked
into every hollow and climbing from the feet), yellowed teeth, soot-black grave
cloth greyed with dust, ragged wool, the oiled leather apron, earth-caked boots,
hemp rope (the S-hook in iron), rusty iron keys, the ash haft and the iron blade
of the spade (one surface told apart along the haft), grave earth, the lantern's
sooted tin and grey hair. The palette is bone ivory, grave-earth umber, soot
black and iron, with the lantern's amber and the sockets' soul green the only
lights (flat glow materials).
"""
import numpy as np

import anatomy as A
from surface import NT, cavity, srgb

KINDS = ('bone', 'tooth', 'cloth', 'breech', 'apron', 'boot', 'rope', 'iron', 'hair', 'spade', 'stuck', 'dirt',
         'tin')
GLOWS = {'glow_eye': ((0.55, 1.0, 0.64), 7.0, 'MarrowEyes'),
         'glow_lantern': ((1.0, 0.64, 0.26), 9.0, 'MarrowLantern')}
EMIT_STRENGTH = 4.0


def uv_boost(obj, c):
    n = obj.name
    m = obj.get('mat')
    if n.startswith('Skull'):
        return 2.3
    if n.startswith('Teeth'):
        return 1.2
    if 'HandBones' in n:
        return 1.3
    if n.startswith('Lantern'):
        return 1.5
    if n.startswith('Spade'):
        return 1.15
    if n.startswith('Stuck'):
        return 0.45
    if m in ('dirt', 'hair'):
        return 0.6
    if n.startswith('Keys'):
        return 0.9
    if n.startswith('Body'):
        return 1.1
    if n.startswith('Boot') or n.endswith('Boot'):
        return 0.8
    return {'cloth': 0.95, 'apron': 0.95, 'breech': 0.75, 'rope': 0.9}.get(m, 1.0)


# ------------------------------------------------------------------ helpers
def _vdot(t, vec, d):
    n = t.node('ShaderNodeVectorMath')
    n.operation = 'DOT_PRODUCT'
    t.link(vec, n.inputs[0])
    n.inputs[1].default_value = tuple(float(x) for x in d)
    return n.outputs['Value']


def _vlen(t, vec):
    n = t.node('ShaderNodeVectorMath')
    n.operation = 'LENGTH'
    t.link(vec, n.inputs[0])
    return n.outputs['Value']


def _along(t, origin, axis):
    """(s, r): the distance along a weapon's haft and from its line, per point."""
    rel = t.vmath('SUBTRACT', t.P, tuple(float(x) for x in origin))
    s = _vdot(t, rel, axis)
    sc = t.node('ShaderNodeVectorMath')
    sc.operation = 'SCALE'
    sc.inputs[0].default_value = tuple(float(x) for x in axis)
    t.link(s, sc.inputs['Scale'])
    off = t.vmath('SUBTRACT', rel, sc.outputs[0])
    return s, _vlen(t, off)


def earth(t, color, rough, h, mask, wet=0.3):
    """Grave earth: umber to near-black clay with grit, rough and lumpy."""
    tone = t.noise(scale=6, detail=4, rough=0.6)
    soil = t.ramp(tone, [(0.3, srgb((0.12, 0.085, 0.06))), (0.7, srgb((0.27, 0.19, 0.12)))])
    grit = t.smooth(t.noise(scale=90, detail=1), 0.62, 0.72)
    soil = t.mix(t.math('MULTIPLY', grit, 0.5), soil, srgb((0.42, 0.36, 0.28)))
    color = t.mix(mask, color, soil)
    rough = t.fmix(mask, rough, 0.93 - 0.25 * wet)
    crust = t.math('MULTIPLY', t.voronoi(scale=16, feature='DISTANCE_TO_EDGE'), mask)
    h = t.math('ADD', h, t.math('MULTIPLY', crust, 0.5))
    return color, rough, h


def rise_mask(t, top, low, amount=1.0, scale=2.0):
    """1 low on him fading out up to `top`, ragged with noise and run up in streaks."""
    n = t.noise(scale=scale, detail=5, rough=0.6)
    z = t.math('ADD', t.pz, t.math('MULTIPLY', t.math('SUBTRACT', n, 0.5), 0.7))
    m = t.math('SUBTRACT', 1.0, t.smooth(z, low, top))
    return t.math('MULTIPLY', m, amount)


def dust(t, color, rough, amount=0.5):
    """Grey dust settled on the faces that look up."""
    up = t.smooth(t.nz, 0.3, 0.85)
    m = t.math('MULTIPLY', t.math('MULTIPLY', up, t.smooth(t.noise(scale=6, detail=3), 0.35, 0.65)), amount)
    color = t.mix(m, color, srgb((0.42, 0.4, 0.37)))
    rough = t.fmix(m, rough, 0.95)
    return color, rough


def _iron(t, base_a=(0.2, 0.2, 0.2), base_b=(0.33, 0.32, 0.31), rust_amt=1.0):
    mott = t.noise(scale=3, detail=5, rough=0.6)
    base = t.ramp(mott, [(0.3, srgb(base_a)), (0.7, srgb(base_b))])
    bloom = t.smooth(t.noise(scale=4.5, detail=6, rough=0.7), 0.55, 0.7)
    crev = t.smooth(t.point, 0.48, 0.42)
    rust = t.math('MULTIPLY', t.math('MAXIMUM', bloom, crev), rust_amt)
    rust_c = t.ramp(t.noise(scale=14, detail=4), [(0.3, srgb((0.2, 0.11, 0.06))), (0.7, srgb((0.4, 0.22, 0.11)))])
    color = t.mix(t.math('MULTIPLY', rust, 0.85), base, rust_c)
    wear = t.math('MULTIPLY', t.smooth(t.point, 0.53, 0.6), t.math('SUBTRACT', 1.0, rust))
    color = t.mix(t.math('MULTIPLY', wear, 0.8), color, srgb((0.56, 0.55, 0.52)))
    color = cavity(t, color, dark=0.45, light=1.1)
    rough = t.fmix(rust, 0.45, 0.88)
    rough = t.fmix(t.math('MULTIPLY', wear, 0.8), rough, 0.32)
    metal = t.fmix(rust, 0.7, 0.05)
    h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=50, detail=3), t.math('ADD', rust, 0.25)),
               t.math('MULTIPLY', t.smooth(t.noise(scale=10, detail=3), 0.55, 0.75), 0.5))
    return color, rough, metal, h


def _spade(t, origin, axis):
    """The spade, told apart along its haft: the grey ash (grain running down it),
    the twine wrap, the iron ferrule bands and straps, the dished iron blade (worn
    bright at the edge, rusted, caked with earth toward the tip)."""
    s, r = _along(t, origin, axis)
    S0, T = A.SOCKET, A.HAFT_TOP
    # wood: ash gone grey, long grain, darker and polished where the hands work
    grain_v = t.vmath('ADD', t.vmath('MULTIPLY', t.P, (40.0, 40.0, 40.0)), (0.0, 0.0, 0.0))
    grain = t.noise(grain_v, scale=1.0, detail=3, dist=3.0)
    wood = t.ramp(grain, [(0.35, srgb((0.3, 0.25, 0.19))), (0.65, srgb((0.46, 0.4, 0.31)))])
    streak = t.smooth(t.noise(t.P, scale=60, detail=2), 0.55, 0.62)
    wood = t.mix(t.math('MULTIPLY', streak, 0.6), wood, srgb((0.2, 0.16, 0.12)))
    grip = t.math('MAXIMUM', t.math('MULTIPLY', t.smooth(s, -0.35, -0.15), t.smooth(s, 0.35, 0.15)),
                  t.math('MULTIPLY', t.smooth(s, -T - 0.1, -T + 0.05), t.smooth(s, -0.85, -1.0)))
    wood = t.mix(t.math('MULTIPLY', grip, 0.55), wood, srgb((0.22, 0.17, 0.12)))
    wood = cavity(t, wood, dark=0.55, light=1.08)
    # the twine wrap, the ferrule bands (raised off the haft)
    raised = t.smooth(r, A.HAFT_R + 0.004, A.HAFT_R + 0.008)
    twine = t.math('MULTIPLY', raised, t.math('MULTIPLY', t.smooth(s, -1.24, -1.19), t.smooth(s, -0.85, -0.9)))
    band = t.math('MULTIPLY', raised, t.math('MULTIPLY', t.smooth(s, -T + 0.22, -T + 0.18), t.smooth(s, -T + 0.04, -T + 0.07)))
    twine_c = t.ramp(t.noise(scale=80, detail=2), [(0.3, srgb((0.3, 0.25, 0.17))), (0.7, srgb((0.45, 0.38, 0.26)))])
    # iron: the straps and socket and the blade
    straps = t.math('MULTIPLY', t.smooth(s, S0 - 0.58, S0 - 0.55), t.smooth(r, A.HAFT_R, A.HAFT_R + 0.004))
    blade = t.smooth(s, S0 - 0.15, S0 - 0.12)
    iron = t.math('MAXIMUM', t.math('MAXIMUM', straps, blade), band)
    ic, ir, im, ih = _iron(t, (0.17, 0.17, 0.17), (0.3, 0.29, 0.28))
    edge = t.math('MULTIPLY', t.smooth(t.point, 0.56, 0.62), blade)
    ic = t.mix(t.math('MULTIPLY', edge, 0.75), ic, srgb((0.62, 0.6, 0.56)))
    color = t.mix(iron, wood, ic)
    color = t.mix(twine, color, twine_c)
    rough = t.fmix(iron, 0.72, ir)
    rough = t.fmix(edge, rough, 0.3)
    metal = t.fmix(iron, 0.0, im)
    h = t.fmix(iron, t.math('MULTIPLY', grain, 0.5), ih)
    h = t.math('ADD', h, t.math('MULTIPLY', twine, t.math('MULTIPLY', t.math('SINE', t.math('MULTIPLY', s, 900.0)),
                                                                        0.4)))
    # earth up the blade from its tip and in the dish
    dirt = t.math('MULTIPLY', t.smooth(t.math('ADD', s, t.math('MULTIPLY', t.noise(scale=4, detail=4), 0.35)),
                                       S0 + 0.25, S0 + 0.65), blade)
    color, rough, h = earth(t, color, rough, h, t.math('MULTIPLY', dirt, 0.85))
    metal = t.fmix(dirt, metal, 0.0)
    t.finish(color, rough, metal, t.bump(h, 0.3, 0.004))


def shade(mat, k):
    t = NT(mat)
    if k == 'bone':
        # old bone: ivory gone yellow-grey, porous, crazed with fine cracks, the
        # hollows packed with grave earth, the earth climbing from the feet
        mott = t.noise(scale=3.2, detail=5, rough=0.55)
        base = t.ramp(mott, [(0.25, srgb((0.62, 0.56, 0.44))), (0.55, srgb((0.76, 0.7, 0.57))),
                             (0.8, srgb((0.84, 0.8, 0.68)))])
        blot = t.smooth(t.noise(scale=5, detail=3, w=3.0), 0.5, 0.72)
        base = t.mix(t.math('MULTIPLY', blot, 0.5), base, srgb((0.5, 0.42, 0.3)))
        craze = t.smooth(t.voronoi(scale=34, feature='DISTANCE_TO_EDGE'), 0.025, 0.0)
        base = t.mix(t.math('MULTIPLY', craze, 0.35), base, srgb((0.3, 0.24, 0.17)))
        hollow = t.smooth(t.point, 0.485, 0.43)
        base = t.mix(t.math('MULTIPLY', hollow, 0.9), base, srgb((0.18, 0.13, 0.09)))
        color = cavity(t, base, dark=0.6, light=1.08)
        pore = t.noise(scale=140, detail=2)
        rough = t.math('ADD', 0.58, t.math('MULTIPLY', t.noise(scale=7, detail=2), 0.2))
        h = t.math('ADD', t.math('MULTIPLY', pore, 0.3), t.math('MULTIPLY', craze, -0.6))
        color, rough, h = earth(t, color, rough, h, rise_mask(t, 2.6, 0.9, 0.75))
        color, rough = dust(t, color, rough, 0.25)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.003))
    elif k == 'tooth':
        base = t.ramp(t.noise(scale=40, detail=2), [(0.3, srgb((0.52, 0.45, 0.3))), (0.7, srgb((0.68, 0.61, 0.44)))])
        root = t.smooth(t.point, 0.47, 0.42)
        color = t.mix(root, base, srgb((0.16, 0.12, 0.08)))
        t.finish(color, 0.4, 0.0)
    elif k == 'cloth':
        # soot-black grave cloth: near-black with a brown cast, faded to a dusty grey
        # on the folds that catch the light, earth along the torn hem
        weave = t.noise(t.scale_vec(150, 150, 150), scale=1.0, detail=2)
        base = t.ramp(t.noise(scale=2.2, detail=4), [(0.3, srgb((0.05, 0.045, 0.045))),
                                                     (0.7, srgb((0.11, 0.1, 0.095)))])
        fade = t.smooth(t.noise(scale=1.3, detail=3), 0.55, 0.75)
        base = t.mix(t.math('MULTIPLY', fade, 0.6), base, srgb((0.2, 0.19, 0.18)))
        color = cavity(t, base, dark=0.45, light=1.25)
        color = t.mix(t.math('MULTIPLY', weave, 0.12), color, srgb((0.22, 0.21, 0.2)))
        hem = t.math('MULTIPLY', t.math('SUBTRACT', 1.0, t.smooth(t.math(
            'ADD', t.pz, t.math('MULTIPLY', t.noise(scale=4, detail=3), 0.25)), 4.0, 4.35)), 0.7)
        h = t.math('ADD', t.math('MULTIPLY', weave, 0.4), t.math('MULTIPLY', t.noise(scale=5, detail=3), 0.6))
        color, rough, h = earth(t, color, 0.9, h, t.math('MULTIPLY', hem, 0.6))
        color, rough = dust(t, color, rough, 0.55)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'breech':
        weave = t.noise(t.scale_vec(120, 120, 120), scale=1.0, detail=2)
        base = t.ramp(t.noise(scale=3, detail=4), [(0.3, srgb((0.12, 0.105, 0.09))), (0.7, srgb((0.2, 0.17, 0.14)))])
        color = cavity(t, base, dark=0.5, light=1.15)
        color = t.mix(t.math('MULTIPLY', weave, 0.15), color, srgb((0.24, 0.22, 0.19)))
        h = t.math('ADD', t.math('MULTIPLY', weave, 0.35), t.math('MULTIPLY', t.noise(scale=5, detail=3), 0.5))
        color, rough, h = earth(t, color, 0.88, h, rise_mask(t, 2.5, 1.85, 0.8, 3.0))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'apron':
        # oiled leather, umber, scuffed pale on the high spots, cracked, smeared with
        # earth across the front and caked at the hem
        base = t.ramp(t.noise(scale=3.5, detail=5), [(0.3, srgb((0.2, 0.12, 0.065))), (0.7, srgb((0.34, 0.21, 0.11)))])
        scuff = t.smooth(t.noise(t.scale_vec(4, 4, 18), scale=1.0, detail=3), 0.6, 0.68)
        base = t.mix(t.math('MULTIPLY', scuff, 0.55), base, srgb((0.46, 0.33, 0.2)))
        crack = t.smooth(t.voronoi(scale=24, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', crack, 0.5), base, srgb((0.06, 0.04, 0.025)))
        color = cavity(t, base, dark=0.45, light=1.2)
        rough = t.math('ADD', 0.5, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.2))
        h = t.math('SUBTRACT', t.math('MULTIPLY', scuff, 0.4), t.math('MULTIPLY', crack, 0.8))
        smear = t.math('MULTIPLY', t.smooth(t.noise(scale=2.4, detail=5, w=4.0), 0.52, 0.66), 0.75)
        color, rough, h = earth(t, color, rough, h, t.math('MAXIMUM', smear, rise_mask(t, 2.1, 1.45, 0.9, 3.0)))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'boot':
        base = t.ramp(t.noise(scale=4, detail=5), [(0.35, srgb((0.11, 0.075, 0.05))), (0.65, srgb((0.2, 0.14, 0.09)))])
        scuff = t.smooth(t.noise(t.scale_vec(5, 5, 26), scale=1.0, detail=3), 0.6, 0.68)
        base = t.mix(t.math('MULTIPLY', scuff, 0.5), base, srgb((0.3, 0.23, 0.16)))
        crack = t.smooth(t.voronoi(scale=30, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', crack, 0.5), base, srgb((0.04, 0.03, 0.02)))
        color = cavity(t, base, dark=0.5, light=1.15)
        h = t.math('SUBTRACT', t.math('MULTIPLY', scuff, 0.4), t.math('MULTIPLY', crack, 0.8))
        color, rough, h = earth(t, color, 0.55, h, rise_mask(t, 0.75, 0.25, 1.0, 3.0))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'rope':
        base = t.ramp(t.noise(scale=30, detail=3), [(0.3, srgb((0.34, 0.27, 0.17))), (0.7, srgb((0.5, 0.42, 0.28)))])
        fib = t.noise(t.scale_vec(220, 220, 220), scale=1.0, detail=2)
        color = cavity(t, base, dark=0.4, light=1.15)
        color = t.mix(t.math('MULTIPLY', fib, 0.25), color, srgb((0.58, 0.5, 0.36)))
        hook = t.smooth(t.px, 0.53, 0.56)
        ic, ir, im, ih = _iron(t)
        color = t.mix(hook, color, ic)
        h = t.fmix(hook, t.math('MULTIPLY', fib, 0.5), ih)
        color, rough, h = earth(t, color, t.fmix(hook, 0.92, ir), h,
                                t.math('MULTIPLY', t.smooth(t.noise(scale=5, detail=3), 0.55, 0.7), 0.6))
        t.finish(color, rough, t.fmix(hook, 0.0, im), t.bump(h, 0.3, 0.003))
    elif k == 'iron':
        color, rough, metal, h = _iron(t)
        t.finish(color, rough, metal, t.bump(h, 0.3, 0.003))
    elif k == 'tin':
        # sooted tin: grey metal gone dull, black soot up the inside of the hood and
        # round the vents, a little rust at the seams
        color, rough, metal, h = _iron(t, (0.34, 0.33, 0.31), (0.5, 0.49, 0.46), rust_amt=0.45)
        c = A.LANTERN_C
        soot = t.math('MULTIPLY', t.smooth(t.pz, c[2] + 0.08, c[2] + 0.3),
                      t.smooth(t.noise(scale=6, detail=3), 0.3, 0.6))
        color = t.mix(t.math('MULTIPLY', soot, 0.85), color, srgb((0.04, 0.035, 0.03)))
        rough = t.fmix(soot, rough, 0.9)
        t.finish(color, rough, t.fmix(soot, metal, 0.1), t.bump(h, 0.3, 0.003))
    elif k == 'hair':
        base = t.ramp(t.noise(t.scale_vec(60, 60, 4), scale=1.0, detail=2), [(0.3, srgb((0.18, 0.17, 0.16))),
                                                                             (0.7, srgb((0.46, 0.45, 0.42)))])
        t.finish(base, 0.7, 0.0)
    elif k == 'spade':
        _spade(t, A.GRIP_R, A.WEAPON_AXIS)
    elif k == 'stuck':
        import dressing as D
        M = D.stuck_matrix()
        _spade(t, M[:3, 3], M[:3, 2])
    elif k == 'dirt':
        color = srgb((0.2, 0.15, 0.1))[:3] + (1.0,)
        color, rough, h = earth(t, color, 0.92, t.noise(scale=60, detail=2), 1.0, wet=0.2)
        stones = t.smooth(t.voronoi(scale=26, feature='F1'), 0.08, 0.04)
        color = t.mix(t.math('MULTIPLY', stones, 0.5), color, srgb((0.5, 0.47, 0.42)))
        color = cavity(t, color, dark=0.4, light=1.15)
        t.finish(color, rough, 0.0, t.bump(h, 0.35, 0.005))
    else:
        raise ValueError(k)
    return mat
