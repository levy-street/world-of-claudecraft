"""The Acolyte's hard dressing and props: the crescent circlet on her brow, the
pearl pendant at her throat, the jellyfish tentacles trailing from the bell's
margin (the veil's strands, riding the veil and face chains), the frost dart
that forms in her hand for the Pale Hymn (Dart, seen only in the attacks), the
orb of cyan light she gives in Pale Mending (Light), and the glowing pool she
dissolves into when she dies (Pool)."""
import math

import bpy
import numpy as np

import anatomy as A
import mesh_kit as K


def _pair(part, attrs=None):
    o = part.to_object()
    if attrs is not None:
        attrs(o)
    hi = K.duplicate(o, o.name + '_hi')
    for nm in [a.name for a in o.data.attributes if a.name.startswith('Reg')]:
        o.data.attributes.remove(o.data.attributes[nm])
    return (hi, o)


def _onto(F, p, lift):
    """A point carried onto a field's surface along its gradient, then lifted."""
    q = np.asarray(p, float)[None, :]
    for _ in range(5):
        d = F.sample(q)
        n = F.gradient(q)
        q = q - n * d[:, None]
    return (q + F.gradient(q) * lift)[0]


def build_circlet(Fh):
    """A fine silver band along the cowl's edge over the brow, a crescent (horns
    up) at its centre and a moon pearl hung beneath it on the forehead."""
    sil = K.Part('Circlet', 'silver', bone='Head')
    pts = []
    for i in range(23):
        th = math.radians(-100 + 200 * i / 22)
        p = A.HEAD_C + A.HEAD_SCALE * np.array((0.17 * math.sin(th), -0.2 * math.cos(th), 0.105 - 0.05 * (1 - math.cos(th))))
        pts.append(_onto(Fh, p, 0.034))
    sil.tube(pts, 0.0085, sides=6)
    c = _onto(Fh, A.HEAD_C + A.HEAD_SCALE * np.array((0.0, -0.2, 0.13)), 0.05)
    arc, rad = [], []
    for i in range(15):
        a = math.radians(200 + 140 * i / 14)
        arc.append(c + np.array((0.042 * math.cos(a), -0.004, 0.042 * math.sin(a) + 0.04)))
        rad.append(0.004 + 0.011 * math.sin(math.pi * i / 14))
    sil.tube(arc, rad, sides=6, up=(0, -1, 0))
    pearl = K.Part('BrowPearl', 'pearl', bone='Head')
    pearl.sphere(_onto(Fh, A.HEAD_C + A.HEAD_SCALE * np.array((0.0, -0.2, 0.075)), 0.014), (0.014, 0.012, 0.016), seg=10, rings=6)
    return [_pair(sil), _pair(pearl)]


def build_pendant(Fb):
    """A fine silver chain round the base of the neck, dipping to a crescent
    that cradles a pearl at the top of the bodice."""
    sil = K.Part('Pendant', 'silver', bone='Spine2')
    pts = []
    for i in range(17):
        u = -1 + 2 * i / 16
        p = np.array((0.13 * u, -0.02 - 0.17 * (1 - u * u), 3.9 - 0.2 * (1 - u * u) ** 1.2))
        if abs(u) > 0.98:
            p[1] = 0.04
        pts.append(_onto(Fb, p, 0.008))
    sil.tube(pts, 0.0045, sides=5)
    c = A.PEARL_AT + np.array((0, -0.005, -0.006))
    arc, rad = [], []
    for i in range(13):
        a = math.radians(200 + 140 * i / 12)
        arc.append(c + np.array((0.042 * math.cos(a), 0.0, 0.042 * math.sin(a) + 0.012)))
        rad.append(0.004 + 0.009 * math.sin(math.pi * i / 12))
    sil.tube(arc, rad, sides=6, up=(0, -1, 0))
    pearl = K.Part('PendantPearl', 'pearl', bone='Spine2')
    pearl.sphere(A.PEARL_AT, (0.03, 0.03, 0.03), seg=12, rings=8)
    return [_pair(sil), _pair(pearl)]


def _strand_len(phi_deg):
    """How far a tentacle falls: to the bust beside the face, to the floor behind."""
    a = abs(phi_deg)
    if a < 85:
        return 3.0
    if a < 120:
        return 2.6 - (a - 85) * 0.065
    return 0.12


def build_tentacles():
    """The moon jelly's fringe: fine tentacles from all round the margin but the
    face, longest at the back where they trail onto the floor over the veil."""
    rng = np.random.default_rng(3)
    p = K.Part('Tentacles', 'tentacle', bone='Head', binding='own')
    starts = []
    angles = [s * a for s in (1, -1) for a in (72, 82, 92, 102, 112, 124, 136, 148, 160, 172)] + [180.0]
    for deg in angles:
        phi = math.radians(deg)
        top = A.bell_point(phi, 0.955, -0.02)
        zend = _strand_len(deg)
        n = 14
        pts, rad = [], []
        side = np.array((math.sin(phi), -math.cos(phi) * 0.0 + (1 if abs(deg) > 90 else 0) * 0.0, 0.0))
        ph = rng.uniform(0, math.tau)
        for i in range(n):
            t = i / (n - 1)
            z = top[2] + (zend - top[2]) * t
            if abs(deg) >= 120:
                # behind: follow the veil's fall, a hand outside it
                vdeg = 180 - abs(deg) if deg > 0 else -(180 - abs(deg))
                q = A.veil_point(vdeg, z) if z < top[2] - 0.15 else top
                b = np.array((math.sin(math.radians(vdeg)), math.cos(math.radians(vdeg)), 0.0))
                q = q + b * 0.05 * min(1.0, t * 4)
            elif abs(deg) >= 85:
                q = top + side * 0.12 * t + np.array((0, 0.06 * t, 0))
                q[2] = z
            else:
                q = top + np.array((math.copysign(0.1, deg) * t, 0.16 * t, 0.0))
                q[2] = z
            wob = 0.035 * math.sin(t * 9 + ph) * t
            q = q + np.array((wob, wob * 0.6, 0.0))
            pts.append(q)
            rad.append(0.017 * (1 - t) + 0.005)
        if abs(deg) >= 120:
            # the tip trails out across the floor
            last = pts[-1]
            b = np.array((math.sin(math.radians(180 - abs(deg))) * np.sign(deg), 1.0, 0.0))
            b /= np.linalg.norm(b)
            for k in range(1, 2):
                pts.append(last + b * 0.08 * k + np.array((0.03 * math.sin(k + ph), 0, 0)))
                rad.append(0.005)
        starts.append((pts[0], pts[-1]))
        p.tube(pts, rad, sides=5)

    def attrs(o):
        from rig import mesh_arrays
        P, _ = mesh_arrays(o)
        tz = np.clip((4.4 - P[:, 2]) / 4.3, 0, 1)
        A._write(o, {'RegT': tz})
    pair = _pair(p, attrs)
    for o in pair:
        o['binding'] = 'own'
    A.hang_weights(pair[1], A.VEIL_CHAINS + A.TENT_CHAINS, 'Head', n_near=2, parent_band=0.25)
    return [pair]


def build_dart():
    """The frost dart of the Pale Hymn: a faceted ice spike lit from within,
    forming at her right fingertips (scaled from nothing on Dart)."""
    h = A.REST['Dart'][0]
    p = K.Part('FrostDart', 'glow_dart', bone='Dart')
    p.tube([h + np.array((0, 0.12, 0)), h + np.array((0, -0.05, 0)), h + np.array((0, -0.32, 0))],
           [0.004, 0.05, 0.002], sides=6)
    for k in range(3):
        a = math.tau * k / 3
        o = np.array((0.035 * math.cos(a), 0.0, 0.035 * math.sin(a)))
        p.tube([h + o * 0.6 + np.array((0, 0.02, 0)), h + o * 1.5 + np.array((0, -0.08, 0)),
                h + o + np.array((0, -0.2, 0))], [0.003, 0.018, 0.002], sides=4)
    return [_pair(p)]


def build_light():
    """The light she gives in Pale Mending: a bright core, two crossed rings and
    a halo of motes (scaled from nothing on Light)."""
    c = A.REST['Light'][0] + np.array((0, 0, 0.15))
    core = K.Part('MendCore', 'glow_light', bone='Light')
    core.sphere(c, (0.2, 0.2, 0.2), seg=16, rings=10)
    rings = K.Part('MendRings', 'glow_mend', bone='Light')
    rings.torus(c, (0, 0.3, 1.0), 0.38, 0.018, seg=32, sides=5)
    rings.torus(c, (0.9, 0.0, 0.4), 0.32, 0.016, seg=28, sides=5)
    rng = np.random.default_rng(13)
    for i in range(10):
        d = rng.normal(0, 1, 3)
        d /= np.linalg.norm(d)
        rings.sphere(c + d * rng.uniform(0.34, 0.5), (0.024, 0.024, 0.024), seg=6, rings=4)
    return [_pair(core), _pair(rings)]


def build_pool():
    """The glowing pool she dissolves into: a flat sheet of moonlit water with a
    brighter rim and a scatter of droplets."""
    c = A.POOL_AT
    pool = K.Part('DeathPool', 'glow_pool', bone='Pool')
    pool.sphere(c + np.array((0, 0, 0.012)), (1.05, 0.95, 0.014), seg=28, rings=6)
    rim = K.Part('DeathRim', 'glow_mend', bone='Pool')
    rim.torus(c + np.array((0, 0, 0.02)), (0, 0, 1), 0.98, 0.022, seg=40, sides=5, squash=(1.0, 0.9))
    rng = np.random.default_rng(21)
    for i in range(14):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0.3, 1.2)
        rr = rng.uniform(0.025, 0.05)
        rim.sphere(c + np.array((math.cos(a) * r, math.sin(a) * r * 0.9, rr * 0.7)), (rr, rr, rr * 0.7), seg=7,
                   rings=4)
    return [_pair(pool), _pair(rim)]


def build(sculpts):
    by = {s.name: s.F for s in sculpts}
    return (build_circlet(by['Head']) + build_pendant(by['Body']) + build_tentacles() + build_dart()
            + build_light() + build_pool())
