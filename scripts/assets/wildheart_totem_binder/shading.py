"""The Totem-Binder's bake surfaces: a jungle troll's teal-green hide, darker
down the back and paler at the belly, coarse and pored, the Sunbone war paint
(bone white round the eyes and down the jaw, white bands on the arms, a red
ochre hand on the chest, red slashes on the thighs), a crest of red hair and
black claw-nails; a hide loincloth spotted like the jaguar; old bone; dark
ironwood; red plumes barred with black; braided cord and leather; ivory tusks.
Glow parts (the gold eyes) keep flat emissive materials."""
import numpy as np

from surface import NT, cavity, srgb

KINDS = ('skin', 'hide', 'bone', 'wood', 'quill', 'rope', 'tooth')
GLOWS = {
    'glow_eye': ((1.0, 0.76, 0.22), 5.0, 'BinderEyes'),
}
EMIT_STRENGTH = 3.0

RED = (0.56, 0.12, 0.06)
BONEPAINT = (0.88, 0.85, 0.74)


def uv_boost(obj, c):
    n = obj.name
    c = np.asarray(c)
    if n.startswith('Head'):
        return 1.7
    if n.endswith('_Hand'):
        return 1.2
    if n.startswith('JaguarMask'):
        return 1.2
    if n.startswith(('BinderStaff', 'Stakes')):
        return 0.9
    if n.startswith(('Neck', 'Belt', 'BundleStraps', 'StaffCords')) or 'Wraps' in n:
        return 0.5
    if c[2] < 0.4:
        return 0.7
    return 1.0


def _band(t, x, c, half, soft=0.02):
    return t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', x, c)), half + soft, half - soft)


def _seg(t, a, b):
    """Distance from the shading point to the segment a -> b."""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    ba = b - a
    pa = t.vmath('SUBTRACT', t.P, tuple(a))
    d = t.vmath('DOT_PRODUCT', pa, tuple(ba))
    dv = [s for s in d.node.outputs if s.name == 'Value'][0]
    h = t.math('MINIMUM', t.math('MAXIMUM', t.math('DIVIDE', dv, float(ba @ ba)), 0.0), 1.0)
    proj = t.vmath('SCALE', tuple(ba))
    sc = [s for s in proj.node.inputs if s.name == 'Scale'][0]
    t.link(h, sc)
    ln = t.vmath('LENGTH', t.vmath('SUBTRACT', pa, proj))
    return [s for s in ln.node.outputs if s.name == 'Value'][0]


def _chip(t, mask, scale=9.0):
    return t.math('MULTIPLY', mask, t.smooth(t.noise(scale=scale, detail=4, w=1.3), 0.3, 0.42))


def _paint(t, color, rough, mask, rgb, scale=9.0):
    m = _chip(t, mask, scale)
    return t.mix(m, color, srgb(rgb)), t.fmix(m, rough, 0.85)


def skin(t):
    import anatomy as A
    ax = t.math('ABSOLUTE', t.px)
    head = t.math('MULTIPLY', t.smooth(t.pz, 4.4, 4.55), t.smooth(t.py, -0.35, -0.5))
    back = t.smooth(t.ny, 0.1, 0.7)
    belly = t.math('MULTIPLY', t.smooth(t.ny, -0.2, -0.7), t.math('MULTIPLY', t.smooth(t.pz, 2.4, 2.7),
                                                                   t.smooth(t.pz, 3.6, 3.3)))
    mott = t.noise(scale=2.0, detail=4)
    base = t.ramp(mott, [(0.3, srgb((0.2, 0.4, 0.37))), (0.7, srgb((0.3, 0.52, 0.46)))])
    base = t.mix(t.math('MULTIPLY', back, 0.7), base, srgb((0.13, 0.28, 0.27)))
    base = t.mix(t.math('MULTIPLY', belly, 0.7), base, srgb((0.46, 0.6, 0.52)))
    # spots and freckles down the back and the arms, darker
    sp = t.smooth(t.voronoi(scale=11.0, feature='F1'), 0.12, 0.06)
    base = t.mix(t.math('MULTIPLY', sp, t.math('MULTIPLY', back, 0.5)), base, srgb((0.08, 0.18, 0.17)))
    # the crest of red hair on the scalp
    hair = t.math('MULTIPLY', t.math('MULTIPLY', t.smooth(t.pz, 5.0, 5.1), t.smooth(ax, 0.16, 0.1)), head)
    strands = t.noise(t.scale_vec(60, 60, 8), scale=1.0, detail=3)
    hair_c = t.ramp(strands, [(0.3, srgb((0.42, 0.06, 0.03))), (0.7, srgb((0.78, 0.2, 0.06)))])
    base = t.mix(hair, base, hair_c)
    color = cavity(t, base, dark=0.5, light=1.08, lo=0.46, hi=0.55)
    rough = t.math('ADD', 0.62, t.math('MULTIPLY', t.noise(scale=8, detail=2), 0.12))
    # --- the Sunbone paint
    eyes = None
    for s in (1, -1):
        dd = t.vmath('DISTANCE', t.P, tuple(A._m(A.EYE, s)))
        dv = [o for o in dd.node.outputs if o.name == 'Value'][0]
        eyes = dv if eyes is None else t.math('MINIMUM', eyes, dv)
    mask = t.math('MULTIPLY', t.smooth(eyes, 0.15, 0.1), t.smooth(t.ny, 0.0, -0.4))
    color, rough = _paint(t, color, rough, mask, BONEPAINT, 22.0)
    jawline = t.math('MULTIPLY', _band(t, t.pz, 4.5, 0.035), t.math('MULTIPLY', head, t.smooth(t.ny, -0.1, -0.5)))
    color, rough = _paint(t, color, rough, jawline, BONEPAINT, 22.0)
    # the red hand on the chest
    hand = t.smooth(_seg(t, (0.0, -0.62, 3.6), (0.0, -0.66, 3.32)), 0.16, 0.12)
    for dx in (-0.12, -0.04, 0.04, 0.12):
        f = t.smooth(_seg(t, (dx * 0.6, -0.62, 3.62), (dx, -0.58, 3.86)), 0.04, 0.03)
        hand = t.math('MAXIMUM', hand, f)
    hand = t.math('MULTIPLY', hand, t.smooth(t.ny, -0.3, -0.6))
    color, rough = _paint(t, color, rough, hand, RED, 14.0)
    for s in (1, -1):
        el, wr = A._m(A.ELBOW, s), A._m(A.WRIST, s)
        sh = A._m(A.SHOULDER, s)
        for u in (0.3, 0.42):
            c = A.lerp(sh, el, u)
            band = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', _seg(t, sh, el), 0.0)), 0.3, 0.28)
            dz = _band(t, t.pz, float(c[2]), 0.035)
            side = t.smooth(t.math('MULTIPLY', t.px, float(s)), 0.5, 0.7)
            color, rough = _paint(t, color, rough, t.math('MULTIPLY', t.math('MULTIPLY', band, dz), side), BONEPAINT,
                                  16.0)
        hp, kn = A._m(A.HIP, s), A._m(A.KNEE, s)
        for k in range(3):
            a = A.lerp(hp, kn, 0.25) + np.array((0.3 * s, -0.2 + 0.08 * k, 0.12 - 0.05 * k))
            b = A.lerp(hp, kn, 0.6) + np.array((0.24 * s, -0.25 + 0.08 * k, 0.0))
            sl = t.math('MULTIPLY', t.smooth(_seg(t, a, b), 0.04, 0.028), t.smooth(t.ny, -0.1, -0.5))
            color, rough = _paint(t, color, rough, sl, RED, 14.0)
    h = t.math('ADD', t.math('MULTIPLY', t.voronoi(scale=45, feature='F1'), -0.5), t.math('MULTIPLY', t.noise(scale=25), 0.4))
    t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.005))


def shade(mat, k):
    t = NT(mat)
    if k == 'skin':
        skin(t)
    elif k == 'hide':
        base = t.ramp(t.noise(scale=6, detail=4), [(0.3, srgb((0.3, 0.17, 0.07))), (0.7, srgb((0.5, 0.32, 0.14)))])
        d = t.voronoi(t.scale_vec(1, 1, 1.4), scale=11.0, feature='F1')
        ring = t.math('MULTIPLY', _band(t, d, 0.36, 0.06), t.smooth(t.noise(scale=20, w=2.0), 0.38, 0.5))
        fill = t.smooth(d, 0.3, 0.24)
        base = t.mix(t.math('MULTIPLY', fill, 0.5), base, srgb((0.42, 0.24, 0.08)))
        base = t.mix(ring, base, srgb((0.06, 0.04, 0.03)))
        edge = t.smooth(t.noise(scale=30, detail=3), 0.6, 0.7)
        color = cavity(t, base, dark=0.5, light=1.1)
        t.finish(color, 0.8, 0.0, t.bump(t.math('ADD', edge, t.noise(scale=80)), 0.25, 0.004))
    elif k == 'bone':
        base = t.ramp(t.noise(scale=9, detail=3), [(0.3, srgb((0.62, 0.55, 0.42))), (0.7, srgb((0.88, 0.82, 0.68)))])
        stain = t.smooth(t.noise(scale=4.5, detail=4, w=1.0), 0.55, 0.72)
        base = t.mix(t.math('MULTIPLY', stain, 0.55), base, srgb((0.42, 0.3, 0.16)))
        cr = t.smooth(t.voronoi(t.scale_vec(1, 1, 2.5), scale=16, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', cr, 0.7), base, srgb((0.25, 0.17, 0.1)))
        stripes = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.pz, 9.0)), 0.5)),
                           0.08, 0.04)
        pick = t.smooth(t.noise(scale=1.3, detail=1, w=3.0), 0.48, 0.56)
        color = cavity(t, base, dark=0.42, light=1.12)
        color, rough = _paint(t, color, 0.5, t.math('MULTIPLY', stripes, pick), RED, 30.0)
        t.finish(color, rough, 0.0, t.bump(t.math('SUBTRACT', t.noise(scale=60, detail=3), cr), 0.3, 0.004))
    elif k == 'wood':
        grain = t.noise(t.scale_vec(16, 16, 2.0), scale=1.0, detail=4, rough=0.6)
        base = t.ramp(grain, [(0.3, srgb((0.12, 0.07, 0.04))), (0.7, srgb((0.32, 0.2, 0.1)))])
        color = cavity(t, base, dark=0.45, light=1.12)
        t.finish(color, 0.7, 0.0, t.bump(grain, 0.35, 0.005))
    elif k == 'quill':
        diag = t.math('ADD', t.math('ADD', t.py, t.pz), t.math('MULTIPLY', t.px, 0.3))
        bars = t.math('FRACT', t.math('MULTIPLY', diag, 7.0))
        barm = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', bars, 0.5)), 0.2, 0.12)
        base = t.ramp(t.noise(scale=12, detail=3), [(0.3, srgb((0.45, 0.06, 0.03))), (0.7, srgb((0.8, 0.15, 0.05)))])
        base = t.mix(t.math('MULTIPLY', barm, 0.7), base, srgb((0.1, 0.04, 0.03)))
        t.finish(cavity(t, base, dark=0.45, light=1.15), 0.55, 0.0, t.bump(t.noise(t.scale_vec(80, 80, 80)), 0.3, 0.003))
    elif k == 'rope':
        base = t.ramp(t.noise(scale=20, detail=3), [(0.3, srgb((0.32, 0.22, 0.12))), (0.7, srgb((0.5, 0.38, 0.22)))])
        fib = t.noise(t.scale_vec(60, 60, 60), scale=4.0, detail=4)
        t.finish(t.mix(t.math('MULTIPLY', t.smooth(fib, 0.55, 0.7), 0.4), base, srgb((0.58, 0.48, 0.3))), 0.85, 0.0,
                 t.bump(fib, 0.35, 0.003))
    elif k == 'tooth':
        base = t.ramp(t.math('ADD', t.math('MULTIPLY', t.noise(scale=14, detail=3), 0.5),
                             t.math('MULTIPLY', t.smooth(t.point, 0.5, 0.58), 0.5)),
                      [(0.3, srgb((0.7, 0.62, 0.46))), (0.75, srgb((0.95, 0.91, 0.8)))])
        t.finish(cavity(t, base, dark=0.5, light=1.08), 0.32, 0.0, t.bump(t.noise(scale=120), 0.12, 0.003))
    else:
        raise ValueError(k)
    return mat
