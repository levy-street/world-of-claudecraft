"""The Turnkey's bake surfaces: bloated drowned flesh, the studded leather jerkin,
bracers and boots, the executioner's hood (dark oiled leather, stitched), the
heavy apron (stained leather), sodden breeches, the rusted irons and keys,
barnacles, kelp and teeth.

Palette: the Bastion's grey-green fog and old brown leather; the brightest notes
are the sea light in the hood's eye holes and in the lantern.
"""
import numpy as np

from surface import NT, cavity, srgb

KINDS = ('flesh', 'plate', 'gauntlet', 'mail', 'cloth', 'sash', 'breech', 'leather', 'hood', 'apron', 'wood',
         'steel', 'barnacle', 'kelp', 'tooth')
GLOWS = {'glow_eye': ((0.42, 1.0, 0.78), 10.0, 'TurnkeyEyes'), 'glow_lantern': ((0.5, 1.0, 0.82), 11.0, 'TurnkeyLantern')}
EMIT_STRENGTH = 4.0


def uv_boost(obj, c):
    m = obj.get('mat')
    c = np.asarray(c)
    if m == 'flesh' and c[2] > 3.85:
        return 2.5
    if m == 'flesh':
        return 1.4
    if m == 'tooth':
        return 1.0
    if m == 'steel':
        return 1.2
    if obj.name.startswith('Helm') or obj.name.startswith('Cuirass'):
        return 1.2
    if m in ('barnacle', 'kelp'):
        return 0.6
    if c[2] < 0.5:
        return 0.7
    return {'mail': 0.7, 'cloth': 1.0, 'sash': 0.9, 'breech': 0.7, 'leather': 0.75, 'gauntlet': 1.1,
            'wood': 0.9}.get(m, 1.0)


def wet(t, color, rough, h, amount=1.0):
    """The sea still on him: water streaks running down from every ledge (long
    vertical streaks), a wet darkening low on the body, a sheen that drops the
    roughness, and a white salt crust dried on the upward faces."""
    streak = t.smooth(t.noise(t.scale_vec(9.0, 9.0, 0.6), scale=1.0, detail=3), 0.55, 0.7)
    low = t.smooth(t.pz, 2.2, 0.6)
    w = t.math('MAXIMUM', t.math('MULTIPLY', streak, 0.6), t.math('MULTIPLY', low, 0.55))
    w = t.math('MULTIPLY', w, amount)
    color = t.mix(t.math('MULTIPLY', w, 0.4), color, t.mix(1.0, color, srgb((0.7, 0.73, 0.72)), 'MULTIPLY'))
    rough = t.fmix(w, rough, t.math('MULTIPLY', rough, 0.45))
    up = t.smooth(t.nz, 0.35, 0.85)
    salt = t.math('MULTIPLY', t.math('MULTIPLY', up, t.smooth(t.noise(scale=7, detail=4, w=5.0), 0.58, 0.68)),
                  0.55 * amount)
    grain = t.smooth(t.noise(scale=160, detail=1), 0.45, 0.7)
    salt = t.math('MULTIPLY', salt, t.fmix(grain, 0.5, 1.0))
    color = t.mix(salt, color, srgb((0.72, 0.74, 0.7)))
    rough = t.fmix(salt, rough, 0.9)
    h = t.math('ADD', h, t.math('MULTIPLY', salt, 0.5))
    return color, rough, h


def algae(t, color, rough, h, amount=1.0):
    """A thin sea-green film in the hollows and on the lower faces."""
    hollow = t.smooth(t.point, 0.5, 0.44)
    patch = t.smooth(t.noise(scale=3.2, detail=5, rough=0.6, w=2.0), 0.45, 0.62)
    m = t.math('MULTIPLY', t.math('MAXIMUM', t.math('MULTIPLY', hollow, 0.8), t.math('MULTIPLY', patch, 0.55)), amount)
    film = t.mix(t.noise(scale=18, detail=3), srgb((0.16, 0.22, 0.15)), srgb((0.3, 0.36, 0.24)))
    color = t.mix(m, color, film)
    rough = t.fmix(m, rough, 0.7)
    return color, rough, h


def _rust_iron(t, base_a, base_b, rust_amt=1.0):
    mott = t.noise(scale=2.4, detail=5, rough=0.6)
    base = t.ramp(mott, [(0.3, srgb(base_a)), (0.7, srgb(base_b))])
    # sea rust: broad blooms, deep pits, and long drips running down from rivets and rims
    bloom = t.smooth(t.noise(scale=3.6, detail=6, rough=0.7), 0.56 - 0.08 * rust_amt, 0.7 - 0.06 * rust_amt)
    drip = t.math('MULTIPLY', t.smooth(t.noise(t.scale_vec(14.0, 14.0, 1.1), scale=1.0, detail=3), 0.6, 0.72), 0.8)
    crev = t.smooth(t.point, 0.48, 0.42)
    rust = t.math('MAXIMUM', t.math('MAXIMUM', bloom, drip), crev)
    rust = t.math('MULTIPLY', rust, rust_amt)
    rust_c = t.ramp(t.noise(scale=12, detail=4), [(0.25, srgb((0.22, 0.15, 0.11))), (0.55, srgb((0.36, 0.25, 0.17))),
                                                  (0.85, srgb((0.48, 0.36, 0.25)))])
    color = t.mix(t.math('MULTIPLY', rust, 0.85), base, rust_c)
    pit = t.smooth(t.noise(scale=30, detail=3), 0.62, 0.7)
    color = t.mix(t.math('MULTIPLY', pit, 0.45), color, srgb((0.12, 0.11, 0.1)))
    wear = t.math('MULTIPLY', t.smooth(t.point, 0.53, 0.6), t.math('SUBTRACT', 1.0, rust))
    color = t.mix(t.math('MULTIPLY', wear, 0.85), color, srgb((0.66, 0.68, 0.68)))
    color = cavity(t, color, dark=0.45, light=1.12)
    rough = t.fmix(rust, 0.42, 0.88)
    rough = t.fmix(t.math('MULTIPLY', wear, 0.8), rough, 0.3)
    metal = t.fmix(rust, 0.38, 0.04)
    h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=45, detail=4), t.math('ADD', rust, 0.2)),
               t.math('MULTIPLY', pit, -0.7))
    h = t.math('ADD', h, t.math('MULTIPLY', t.smooth(t.noise(scale=9, detail=3), 0.55, 0.75), 0.6))   # flaking
    return color, rough, metal, h


def _box(t, xv, x0, x1, z0, z1):
    return t.math('MULTIPLY', t.math('MULTIPLY', t.smooth(xv, x1 + 0.01, x1), t.smooth(xv, x0 - 0.01, x0)),
                  t.math('MULTIPLY', t.smooth(t.pz, z0, z0 + 0.01), t.smooth(t.pz, z1, z1 - 0.01)))


def shade(mat, k):
    t = NT(mat)
    if k == 'flesh':
        # drowned flesh: waterlogged grey with a green-blue cast, marbled with dark
        # veins, livid round the eyes and mouth, slick and glossy, the skin slipping
        mott = t.noise(scale=3.0, detail=4, rough=0.55)
        base = t.ramp(mott, [(0.3, srgb((0.47, 0.52, 0.48))), (0.7, srgb((0.62, 0.66, 0.6)))])
        blot = t.smooth(t.noise(scale=5, detail=3, w=3.0), 0.5, 0.72)
        base = t.mix(t.math('MULTIPLY', blot, 0.55), base, srgb((0.36, 0.42, 0.44)))
        marble = t.smooth(t.noise(t.scale_vec(22, 22, 9), scale=1.0, detail=3, dist=2.0), 0.6, 0.64)
        base = t.mix(t.math('MULTIPLY', marble, 0.55), base, srgb((0.2, 0.25, 0.27)))
        # livid round the sockets, the nostrils, the lips and the torn cheek (the hollows)
        sock = t.smooth(t.point, 0.47, 0.4)
        base = t.mix(t.math('MULTIPLY', sock, 0.85), base, srgb((0.12, 0.13, 0.15)))
        # slipped skin: pale patches where the outer layer has gone
        slip = t.math('MULTIPLY', t.smooth(t.noise(scale=7, detail=4, w=8.0), 0.62, 0.68), 0.7)
        base = t.mix(slip, base, srgb((0.7, 0.72, 0.66)))
        color = cavity(t, base, dark=0.55, light=1.06)
        rough = t.math('ADD', 0.32, t.math('MULTIPLY', t.noise(scale=8, detail=2), 0.18))
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=110, detail=2), 0.2), t.math('MULTIPLY', marble, 0.25))
        h = t.math('SUBTRACT', h, t.math('MULTIPLY', slip, 0.4))
        color, rough, h = wet(t, color, rough, h, amount=0.5)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k in ('plate', 'gauntlet'):
        color, rough, metal, h = _rust_iron(t, (0.36, 0.39, 0.4), (0.5, 0.53, 0.53))
        if k == 'gauntlet':
            lames = t.smooth(t.math('SINE', t.math('MULTIPLY', t.math('ADD', t.px, t.pz), 95.0)), 0.85, 0.98)
            color = t.mix(t.math('MULTIPLY', lames, 0.6), color, srgb((0.07, 0.07, 0.07)))
            h = t.math('SUBTRACT', h, t.math('MULTIPLY', lames, 0.8))
        color, rough, h = algae(t, color, rough, h, amount=0.6)
        color, rough, h = wet(t, color, rough, h)
        t.finish(color, rough, metal, t.bump(h, 0.35, 0.006))
    elif k == 'mail':
        v = t.scale_vec(34, 34, 48)
        ring = t.voronoi(v, scale=1.0, feature='F1')
        hole = t.smooth(ring, 0.22, 0.12)
        link = t.math('MULTIPLY', t.smooth(ring, 0.12, 0.2), t.smooth(ring, 0.45, 0.33))
        base = t.ramp(t.noise(scale=3, detail=4), [(0.3, srgb((0.3, 0.3, 0.28))), (0.7, srgb((0.42, 0.42, 0.39)))])
        rust = t.smooth(t.noise(scale=5, detail=6, rough=0.7), 0.5, 0.64)
        base = t.mix(t.math('MULTIPLY', rust, 0.85), base, srgb((0.26, 0.17, 0.11)))
        color = t.mix(hole, base, srgb((0.03, 0.03, 0.03)))
        color = t.mix(t.math('MULTIPLY', link, 0.35), color, srgb((0.56, 0.56, 0.53)))
        color = cavity(t, color, dark=0.5, light=1.1)
        rough = t.fmix(rust, 0.45, 0.88)
        metal = t.fmix(t.math('MAXIMUM', hole, rust), 0.75, 0.08)
        h = t.math('ADD', t.math('MULTIPLY', link, 0.7), t.math('MULTIPLY', hole, -0.6))
        color, rough, h = algae(t, color, rough, h, amount=0.5)
        color, rough, h = wet(t, color, rough, h)
        t.finish(color, rough, metal, t.bump(h, 0.45, 0.005))
    elif k == 'cloth':
        # the Bastion's tabard: once a deep sea-green, faded to the colour of fog, the
        # tower over three waves in pale thread on the front; sodden, stained by
        # rust from the belt and weed toward the torn hem
        weave = t.noise(t.scale_vec(160, 160, 160), scale=1.0, detail=2)
        base = t.ramp(t.noise(scale=2.5, detail=4), [(0.3, srgb((0.17, 0.24, 0.22))), (0.7, srgb((0.24, 0.32, 0.29)))])
        fade = t.smooth(t.noise(scale=1.2, detail=3), 0.5, 0.72)
        base = t.mix(t.math('MULTIPLY', fade, 0.55), base, srgb((0.3, 0.34, 0.31)))
        ex = t.math('ABSOLUTE', t.px)
        front = t.smooth(t.py, -0.3, -0.38)
        # the tower: a shaft with a crenellated top and a gate, over three waves
        shaft = _box(t, ex, -0.01, 0.075, 2.02, 2.34)
        crown = _box(t, ex, -0.01, 0.105, 2.34, 2.4)
        merl = t.math('MULTIPLY', _box(t, ex, -0.01, 0.105, 2.4, 2.45),
                      t.smooth(t.math('ABSOLUTE', t.math('SINE', t.math('MULTIPLY', t.px, 45.0))), 0.25, 0.35))
        gate = _box(t, ex, -0.01, 0.03, 2.02, 2.12)
        tower = t.math('SUBTRACT', t.math('MAXIMUM', t.math('MAXIMUM', shaft, crown), merl), gate, clamp=True)
        waves = None
        for zc in (1.97, 1.91, 1.85):
            wz = t.math('ADD', zc, t.math('MULTIPLY', t.math('SINE', t.math('MULTIPLY', t.px, 28.0)), 0.012))
            band = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.pz, wz)), 0.011, 0.005)
            band = t.math('MULTIPLY', band, t.smooth(ex, 0.17, 0.15))
            waves = band if waves is None else t.math('MAXIMUM', waves, band)
        rr = t.math('SQRT', t.math('ADD', t.math('MULTIPLY', t.px, t.px),
                                   t.math('MULTIPLY', t.math('SUBTRACT', t.pz, 2.12), t.math('SUBTRACT', t.pz, 2.12))))
        ring = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', rr, 0.36)), 0.016, 0.006)
        emb = t.math('MAXIMUM', t.math('MAXIMUM', tower, waves), ring)
        frayed = t.smooth(t.noise(scale=40, detail=2), 0.3, 0.5)
        emb = t.math('MULTIPLY', t.math('MULTIPLY', emb, front), frayed)
        base = t.mix(t.math('MULTIPLY', emb, 0.8), base, srgb((0.6, 0.62, 0.55)))
        # rust run from the belt, weed stain rising from the hem
        rustrun = t.math('MULTIPLY', t.smooth(t.noise(t.scale_vec(10, 10, 0.8), scale=1.0, detail=2), 0.6, 0.72),
                         t.smooth(t.pz, 2.0, 2.55))
        base = t.mix(t.math('MULTIPLY', rustrun, 0.6), base, srgb((0.24, 0.15, 0.1)))
        stain = t.smooth(t.math('ADD', t.pz, t.math('MULTIPLY', t.noise(scale=3, detail=3), 0.3)), 1.75, 1.2)
        base = t.mix(t.math('MULTIPLY', stain, 0.7), base, srgb((0.12, 0.15, 0.1)))
        color = cavity(t, base, dark=0.55, light=1.1)
        color = t.mix(t.math('MULTIPLY', weave, 0.12), color, srgb((0.34, 0.37, 0.34)))
        h = t.math('ADD', t.math('MULTIPLY', weave, 0.4), t.math('MULTIPLY', t.noise(scale=6, detail=3), 0.6))
        color, rough, h = wet(t, color, 0.75, h, amount=0.9)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'sash':
        # the sergeant's sash: a heavy twill once madder red, faded and sodden to the
        # brown-red of old blood, the folds darker, salt-bleached along the edges
        weave = t.noise(t.scale_vec(150, 150, 150), scale=1.0, detail=2)
        base = t.ramp(t.noise(scale=3, detail=4), [(0.3, srgb((0.3, 0.12, 0.09))), (0.7, srgb((0.42, 0.19, 0.13)))])
        fade = t.smooth(t.noise(scale=1.5, detail=3), 0.52, 0.72)
        base = t.mix(t.math('MULTIPLY', fade, 0.5), base, srgb((0.46, 0.33, 0.28)))
        color = cavity(t, base, dark=0.5, light=1.12)
        color = t.mix(t.math('MULTIPLY', weave, 0.12), color, srgb((0.4, 0.26, 0.2)))
        h = t.math('ADD', t.math('MULTIPLY', weave, 0.4), t.math('MULTIPLY', t.noise(scale=6, detail=3), 0.5))
        color, rough, h = algae(t, color, 0.8, h, amount=0.3)
        color, rough, h = wet(t, color, rough, h, amount=0.9)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'wood':
        grain = t.noise(t.scale_vec(6, 6, 60), scale=1.0, detail=4)
        base = t.ramp(grain, [(0.3, srgb((0.2, 0.16, 0.12))), (0.7, srgb((0.34, 0.27, 0.19)))])
        rot = t.smooth(t.noise(scale=5, detail=3, w=2.0), 0.55, 0.7)
        base = t.mix(t.math('MULTIPLY', rot, 0.6), base, srgb((0.14, 0.15, 0.12)))
        color = cavity(t, base, dark=0.5, light=1.12)
        color, rough, h = algae(t, color, 0.75, t.math('MULTIPLY', grain, 0.6), amount=0.4)
        color, rough, h = wet(t, color, rough, h, amount=0.7)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'hood':
        # the executioner's hood: dark oiled leather, near black where it is wettest,
        # the seams stitched, salt crusting the crown
        base = t.ramp(t.noise(scale=3, detail=4), [(0.3, srgb((0.15, 0.12, 0.1))), (0.7, srgb((0.25, 0.2, 0.15)))])
        scuff = t.smooth(t.noise(t.scale_vec(6, 6, 18), scale=1.0, detail=3), 0.6, 0.7)
        base = t.mix(t.math('MULTIPLY', scuff, 0.5), base, srgb((0.34, 0.28, 0.21)))
        color = cavity(t, base, dark=0.55, light=1.2)
        rough = t.math('ADD', 0.5, t.math('MULTIPLY', t.noise(scale=5, detail=2), 0.2))
        h = t.math('MULTIPLY', scuff, 0.4)
        color, rough, h = wet(t, color, rough, h, amount=1.0)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'apron':
        base = t.ramp(t.noise(scale=3.5, detail=4), [(0.3, srgb((0.2, 0.15, 0.11))), (0.7, srgb((0.32, 0.24, 0.17)))])
        stain = t.smooth(t.noise(scale=2.5, detail=4, w=5.0), 0.55, 0.7)
        base = t.mix(t.math('MULTIPLY', stain, 0.7), base, srgb((0.12, 0.07, 0.05)))
        crack = t.smooth(t.voronoi(scale=24, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', crack, 0.5), base, srgb((0.06, 0.05, 0.04)))
        color = cavity(t, base, dark=0.5, light=1.15)
        h = t.math('SUBTRACT', t.math('MULTIPLY', stain, 0.3), t.math('MULTIPLY', crack, 0.8))
        color, rough, h = algae(t, color, 0.6, h, amount=0.35)
        color, rough, h = wet(t, color, rough, h, amount=1.0)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'breech':
        weave = t.noise(t.scale_vec(120, 120, 120), scale=1.0, detail=2)
        base = t.ramp(t.noise(scale=3, detail=4), [(0.3, srgb((0.25, 0.22, 0.18))), (0.7, srgb((0.34, 0.3, 0.25)))])
        color = cavity(t, base, dark=0.5, light=1.1)
        color = t.mix(t.math('MULTIPLY', weave, 0.15), color, srgb((0.3, 0.29, 0.26)))
        h = t.math('ADD', t.math('MULTIPLY', weave, 0.35), t.math('MULTIPLY', t.noise(scale=5, detail=3), 0.5))
        color, rough, h = algae(t, color, 0.8, h, amount=0.5)
        color, rough, h = wet(t, color, rough, h, amount=1.0)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'leather':
        base = t.ramp(t.noise(scale=4, detail=5), [(0.35, srgb((0.17, 0.13, 0.1))), (0.65, srgb((0.28, 0.21, 0.15)))])
        scuff = t.smooth(t.noise(t.scale_vec(5, 5, 26), scale=1.0, detail=3), 0.6, 0.68)
        base = t.mix(t.math('MULTIPLY', scuff, 0.6), base, srgb((0.3, 0.25, 0.2)))
        crack = t.smooth(t.voronoi(scale=30, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', crack, 0.5), base, srgb((0.05, 0.04, 0.03)))
        # tide lines: pale salt rings dried round the boots
        tz = t.math('ADD', t.pz, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.06))
        tide = t.smooth(t.math('ABSOLUTE', t.math('SINE', t.math('MULTIPLY', tz, 17.0))), 0.97, 0.995)
        tide = t.math('MULTIPLY', tide, t.smooth(t.pz, 0.75, 0.3))
        tide = t.math('MULTIPLY', tide, t.smooth(t.noise(scale=3, detail=2, w=4.0), 0.4, 0.6))
        base = t.mix(t.math('MULTIPLY', tide, 0.3), base, srgb((0.5, 0.5, 0.46)))
        color = cavity(t, base, dark=0.5, light=1.15)
        rough = t.math('ADD', 0.45, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.2))
        h = t.math('SUBTRACT', t.math('MULTIPLY', scuff, 0.4), t.math('MULTIPLY', crack, 0.8))
        color, rough, h = wet(t, color, rough, h, amount=1.0)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'steel':
        color, rough, metal, h = _rust_iron(t, (0.46, 0.48, 0.48), (0.58, 0.6, 0.6), rust_amt=0.85)
        metal = t.math('MULTIPLY', metal, 0.7)
        # the edge stays brighter where it is still sharpened by use
        edge = t.smooth(t.point, 0.56, 0.62)
        color = t.mix(t.math('MULTIPLY', edge, 0.5), color, srgb((0.64, 0.66, 0.66)))
        rough = t.fmix(edge, rough, 0.3)
        color, rough, h = wet(t, color, rough, h, amount=0.6)
        t.finish(color, rough, metal, t.bump(h, 0.3, 0.004))
    elif k == 'barnacle':
        base = t.ramp(t.noise(scale=30, detail=3), [(0.3, srgb((0.42, 0.41, 0.37))), (0.7, srgb((0.56, 0.55, 0.5)))])
        crater = t.smooth(t.point, 0.47, 0.4)
        base = t.mix(crater, base, srgb((0.07, 0.08, 0.07)))
        ridge = t.smooth(t.point, 0.54, 0.6)
        base = t.mix(t.math('MULTIPLY', ridge, 0.5), base, srgb((0.66, 0.65, 0.6)))
        color = cavity(t, base, dark=0.5, light=1.1)
        color, rough, h = algae(t, color, 0.8, t.noise(scale=80, detail=2), amount=0.65)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.003))
    elif k == 'kelp':
        base = t.ramp(t.noise(t.scale_vec(6, 6, 1.5), scale=1.0, detail=3), [(0.3, srgb((0.12, 0.13, 0.06))),
                                                                          (0.7, srgb((0.24, 0.24, 0.1)))])
        vein = t.smooth(t.noise(t.scale_vec(40, 40, 3), scale=1.0, detail=2), 0.55, 0.62)
        base = t.mix(t.math('MULTIPLY', vein, 0.4), base, srgb((0.3, 0.3, 0.14)))
        color = cavity(t, base, dark=0.5, light=1.1)
        t.finish(color, 0.3, 0.0, t.bump(t.noise(scale=60, detail=2), 0.2, 0.003))
    elif k == 'tooth':
        base = t.ramp(t.noise(scale=40, detail=2), [(0.3, srgb((0.5, 0.45, 0.32))), (0.7, srgb((0.66, 0.6, 0.45)))])
        root = t.smooth(t.point, 0.47, 0.42)
        color = t.mix(root, base, srgb((0.18, 0.14, 0.1)))
        t.finish(color, 0.35, 0.0)
    else:
        raise ValueError(k)
    return mat
