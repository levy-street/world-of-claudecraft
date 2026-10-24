"""The Great Jaguar's surfaces: procedural bake shaders per kind (adapted from
the Balgath and Great Saurian kits), the shared UV atlas, and the high-to-low
Cycles bake into one albedo, one tangent normal map and one roughness/metallic
map.

Kinds: skin (the coat: gold over cream, broken rosettes filled darker, solid
spots on the head, legs and belly, tail rings and a black tip, black lips and
ear backs, the Sunbone war paint: a bone-white sun with red rays on each
shoulder, red tally slashes on the haunches, red chevrons on the forehead,
white bars under the eyes; the pale scars), bone, tooth, claw, eye, mouth,
whisker, jade (the bond ring), leather, rope.
"""
import math
import os

import bpy
import numpy as np

KINDS = ('skin', 'bone', 'tooth', 'claw', 'eye', 'mouth', 'whisker', 'jade', 'leather', 'rope')


def srgb(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


class NT:
    """Terse node-tree builder."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        for n in list(self.nt.nodes):
            self.nt.nodes.remove(n)
        self.x = -1600
        self.out = self.node('ShaderNodeOutputMaterial')
        self.bsdf = self.node('ShaderNodeBsdfPrincipled')
        self.link(self.bsdf.outputs['BSDF'], self.out.inputs['Surface'])
        tc = self.node('ShaderNodeTexCoord')
        self.P = tc.outputs['Object']
        geo = self.node('ShaderNodeNewGeometry')
        self.N = geo.outputs['Normal']
        self.point = geo.outputs['Pointiness']
        sep = self.node('ShaderNodeSeparateXYZ')
        self.link(self.P, sep.inputs[0])
        self.px, self.py, self.pz = sep.outputs['X'], sep.outputs['Y'], sep.outputs['Z']
        sepn = self.node('ShaderNodeSeparateXYZ')
        self.link(self.N, sepn.inputs[0])
        self.nx, self.ny, self.nz = sepn.outputs['X'], sepn.outputs['Y'], sepn.outputs['Z']

    def node(self, kind, **inputs):
        n = self.nt.nodes.new(kind)
        n.location = (self.x, 0)
        self.x += 40
        for k, v in inputs.items():
            n.inputs[k].default_value = v
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def val(self, sock_or_val):
        return sock_or_val

    def _in(self, node, idx, v):
        if hasattr(v, 'is_output'):
            self.link(v, node.inputs[idx])
        else:
            sock = node.inputs[idx]
            if sock.type == 'RGBA' and isinstance(v, (int, float)):
                v = (v, v, v, 1.0)
            sock.default_value = v

    def math(self, op, a, b=0.0, clamp=False):
        n = self.node('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        self._in(n, 0, a)
        self._in(n, 1, b)
        return n.outputs[0]

    def vmath(self, op, a, b=(0, 0, 0)):
        n = self.node('ShaderNodeVectorMath')
        n.operation = op
        self._in(n, 0, a)
        self._in(n, 1, b)
        return n.outputs[0]

    def noise(self, vec=None, scale=1.0, detail=4.0, rough=0.55, dist=0.0, w=None):
        n = self.node('ShaderNodeTexNoise')
        if w is not None:
            n.noise_dimensions = '4D'
            n.inputs['W'].default_value = w
        self.link(vec if vec is not None else self.P, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = dist
        return n.outputs['Fac']

    def voronoi(self, vec=None, scale=1.0, feature='F1', out='Distance', rnd=1.0):
        n = self.node('ShaderNodeTexVoronoi')
        n.feature = feature
        self.link(vec if vec is not None else self.P, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Randomness'].default_value = rnd
        return n.outputs[out]

    def scale_vec(self, sx, sy, sz, vec=None):
        n = self.node('ShaderNodeMapping')
        self.link(vec if vec is not None else self.P, n.inputs['Vector'])
        n.inputs['Scale'].default_value = (sx, sy, sz)
        return n.outputs['Vector']

    def ramp(self, fac, stops):
        """stops: [(pos, value_or_rgb)]; returns a Color socket."""
        n = self.node('ShaderNodeValToRGB')
        self._in(n, 0, fac)
        el = n.color_ramp.elements
        while len(el) < len(stops):
            el.new(0.5)
        for e, (pos, c) in zip(el, stops):
            e.position = pos
            e.color = c if (isinstance(c, tuple) and len(c) == 4) else (c, c, c, 1.0) if not isinstance(c, tuple) else (*c, 1.0)
        return n.outputs['Color']

    def mix(self, fac, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = blend
        self._in(n, 0, fac)
        sa = [s for s in n.inputs if s.name == 'A' and s.type == 'RGBA'][0]
        sb = [s for s in n.inputs if s.name == 'B' and s.type == 'RGBA'][0]
        for s, v in ((sa, a), (sb, b)):
            if hasattr(v, 'is_output'):
                self.link(v, s)
            else:
                s.default_value = v
        return [s for s in n.outputs if s.name == 'Result' and s.type == 'RGBA'][0]

    def fmix(self, fac, a, b):
        n = self.node('ShaderNodeMix')
        n.data_type = 'FLOAT'
        self._in(n, 0, fac)
        sa = [s for s in n.inputs if s.name == 'A' and s.type == 'VALUE'][0]
        sb = [s for s in n.inputs if s.name == 'B' and s.type == 'VALUE'][0]
        for s, v in ((sa, a), (sb, b)):
            if hasattr(v, 'is_output'):
                self.link(v, s)
            else:
                s.default_value = v
        return [s for s in n.outputs if s.name == 'Result' and s.type == 'VALUE'][0]

    def smooth(self, x, lo, hi):
        n = self.node('ShaderNodeMapRange')
        n.interpolation_type = 'SMOOTHSTEP'
        self._in(n, 0, x)
        self._in(n, 1, lo)
        self._in(n, 2, hi)
        return n.outputs[0]

    def bump(self, height, strength=0.3, distance=0.02, normal=None):
        n = self.node('ShaderNodeBump')
        self._in(n, 'Height', height)
        n.inputs['Strength'].default_value = strength
        n.inputs['Distance'].default_value = distance
        if normal is not None:
            self.link(normal, n.inputs['Normal'])
        return n.outputs['Normal']

    def finish(self, color, rough, metal, normal=None, mat=None):
        self._in(self.bsdf, 'Base Color', color)
        self._in(self.bsdf, 'Roughness', rough)
        self._in(self.bsdf, 'Metallic', metal)
        if normal is not None:
            self.link(normal, self.bsdf.inputs['Normal'])
        # remember the metallic signal for the EMIT bake
        em = self.node('ShaderNodeEmission')
        em.name = 'METAL_EMIT'
        self._in(em, 'Color', metal)
        em.inputs['Strength'].default_value = 1.0


# ------------------------------------------------------------------ shared masks

def cavity(t, color, dark=0.55, light=1.12, lo=0.47, hi=0.53):
    concave = t.smooth(t.point, lo, lo - 0.08)
    convex = t.smooth(t.point, hi, hi + 0.08)
    color = t.mix(concave, color, t.mix(1.0, color, srgb((dark * 0.6, dark * 0.55, dark * 0.5)), 'MULTIPLY'))
    color = t.mix(t.math('MULTIPLY', convex, 0.6), color, t.mix(1.0, color, srgb((light, light, light * 0.97)), 'MULTIPLY'))
    return color


# ------------------------------------------------------------------ kinds
RED = (0.56, 0.13, 0.06)
OCHRE = (0.78, 0.52, 0.16)
BONEPAINT = (0.86, 0.82, 0.7)


def length2(t, a, a0, b, b0):
    da = t.math('SUBTRACT', a, a0)
    db = t.math('SUBTRACT', b, b0)
    return t.math('SQRT', t.math('ADD', t.math('MULTIPLY', da, da), t.math('MULTIPLY', db, db)))


def chip(t, mask, scale=7.0):
    """Paint worn off in flakes."""
    return t.math('MULTIPLY', mask, t.smooth(t.noise(scale=scale, detail=4, w=1.3), 0.3, 0.42))


def paint(t, color, rough, mask, rgb, chip_scale=7.0):
    m = chip(t, mask, chip_scale)
    color = t.mix(m, color, srgb(rgb))
    rough = t.fmix(m, rough, 0.82)
    return color, rough


def band(t, x, center, half, soft=0.03):
    """1 within `half` of `center` along x."""
    return t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', x, center)), half + soft, half - soft)


def between(t, x, lo, hi, soft=0.05):
    return t.math('MULTIPLY', t.smooth(x, lo - soft, lo + soft), t.smooth(x, hi + soft, hi - soft))


def vec3(t, x, y, z):
    n = t.node('ShaderNodeCombineXYZ')
    for i, v in enumerate((x, y, z)):
        t._in(n, i, v)
    return n.outputs[0]


def seg_dist(t, P, a, b):
    """Distance from the shading point to the segment a -> b (object space)."""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    ba = b - a
    pa = t.vmath('SUBTRACT', P, tuple(a))
    d = t.vmath('DOT_PRODUCT', pa, tuple(ba))
    dv = [s for s in d.node.outputs if s.name == 'Value'][0]
    h = t.math('DIVIDE', dv, float(ba @ ba), clamp=False)
    h = t.math('MINIMUM', t.math('MAXIMUM', h, 0.0), 1.0)
    proj = t.vmath('SCALE', tuple(ba))
    sc = [s for s in proj.node.inputs if s.name == 'Scale'][0]
    t.link(h, sc)
    diff = t.vmath('SUBTRACT', pa, proj)
    ln = t.vmath('LENGTH', diff)
    return [s for s in ln.node.outputs if s.name == 'Value'][0]


def polyline_dist(t, P, pts):
    out = None
    for a, b in zip(pts, pts[1:]):
        d = seg_dist(t, P, a, b)
        out = d if out is None else t.math('MINIMUM', out, d)
    return out


GOLD_BACK = (0.78, 0.5, 0.14)
GOLD = (0.88, 0.62, 0.22)
CREAM = (0.93, 0.87, 0.72)
SPOT = (0.07, 0.05, 0.035)
SCAR = (0.74, 0.55, 0.47)


def fur(t):
    """The jaguar's coat: gold over cream, rosettes broken and filled darker,
    solid spots on the head, the legs and the belly, rings and a black tip on the
    tail, the Sunbone paint and the old scars."""
    import anatomy as A
    P = t.P
    ax = t.math('ABSOLUTE', t.px)
    anx = t.math('ABSOLUTE', t.nx)
    # -------- masks
    legs = t.math('MULTIPLY', t.smooth(t.pz, 1.55, 1.1), t.smooth(ax, 0.35, 0.55))
    head = t.smooth(t.py, -3.45, -3.75)
    tail = t.smooth(t.py, 2.75, 3.05)
    tail_tip = t.smooth(t.py, 4.55, 4.75)
    under = t.smooth(t.nz, -0.05, -0.55)
    torso_under = t.math('MULTIPLY', under, t.math('SUBTRACT', 1.0, head))
    inner_leg = t.math('MULTIPLY', t.math('MULTIPLY', legs, t.smooth(t.math('MULTIPLY', t.px, t.nx), 0.0, -0.3)), 0.7)
    belly = t.math('MAXIMUM', torso_under, inner_leg)
    # throat, chin and the muzzle are pale
    chin = t.math('MULTIPLY', t.math('MULTIPLY', head, t.smooth(t.pz, 3.6, 3.38)), t.smooth(t.nz, 0.2, -0.3))
    throat = t.math('MULTIPLY', t.math('MULTIPLY', between(t, t.py, -3.9, -2.4, 0.2), t.smooth(t.nz, 0.1, -0.4)),
                    t.smooth(t.pz, 3.3, 2.6))
    pale = t.math('MAXIMUM', belly, t.math('MAXIMUM', chin, throat))
    # -------- ground colour
    mott = t.noise(scale=1.1, detail=3)
    base = t.mix(mott, srgb(GOLD), srgb((0.84, 0.56, 0.18)))
    dorsal = t.smooth(t.nz, 0.35, 0.95)
    base = t.mix(t.math('MULTIPLY', dorsal, 0.65), base, srgb(GOLD_BACK))
    base = t.mix(t.smooth(pale, 0.15, 0.7), base, srgb(CREAM))
    # warm flush where the gold meets the cream
    flush = t.math('MULTIPLY', band(t, pale, 0.35, 0.2, 0.15), 0.35)
    base = t.mix(flush, base, srgb((0.92, 0.66, 0.3)))
    # -------- rosettes (torso, upper legs, tail base)
    nzv = t.node('ShaderNodeTexNoise')
    nzv.inputs['Scale'].default_value = 2.6
    t.link(P, nzv.inputs['Vector'])
    warped = t.vmath('ADD', t.scale_vec(1.0, 0.82, 1.0), t.vmath('MULTIPLY', nzv.outputs['Color'], (0.18, 0.18, 0.18)))
    d = t.voronoi(warped, scale=2.3, feature='F1')
    ang_break = t.smooth(t.noise(scale=11, detail=2, w=1.7), 0.38, 0.5)
    ring = t.math('MULTIPLY', band(t, d, 0.37, 0.085, 0.03), ang_break)
    fill = t.smooth(d, 0.33, 0.28)
    dots = t.smooth(t.voronoi(warped, scale=7.5, feature='F1'), 0.11, 0.07)
    dots = t.math('MULTIPLY', dots, t.smooth(d, 0.24, 0.18))
    rosette_zone = t.math('MULTIPLY', t.math('SUBTRACT', 1.0, t.math('MAXIMUM', head, t.smooth(pale, 0.3, 0.7))),
                          t.math('SUBTRACT', 1.0, t.math('MULTIPLY', legs, 0.85)))
    rosette_zone = t.math('MULTIPLY', rosette_zone, t.math('SUBTRACT', 1.0, tail_tip))
    base = t.mix(t.math('MULTIPLY', fill, t.math('MULTIPLY', rosette_zone, 0.55)), base, srgb((0.66, 0.36, 0.09)))
    spot_m = t.math('MULTIPLY', t.math('MAXIMUM', ring, dots), rosette_zone)
    # -------- solid spots (head, legs, belly), smaller on the head and paws
    sd_small = t.voronoi(warped, scale=8.5, feature='F1')
    sd_mid = t.voronoi(warped, scale=4.2, feature='F1')
    small = t.smooth(sd_small, 0.25, 0.18)
    mid = t.smooth(sd_mid, 0.27, 0.2)
    head_sp = t.math('MULTIPLY', small, t.math('MULTIPLY', head, t.smooth(t.pz, 3.7, 3.85)))
    leg_sp = t.math('MULTIPLY', t.math('MAXIMUM', small, t.math('MULTIPLY', mid, t.smooth(t.pz, 0.8, 1.2))),
                    t.math('MULTIPLY', legs, t.math('SUBTRACT', 1.0, head)))
    belly_sp = t.math('MULTIPLY', mid, t.math('MULTIPLY', t.smooth(pale, 0.5, 0.8), t.math('SUBTRACT', 1.0, head)))
    spot_m = t.math('MAXIMUM', spot_m, t.math('MAXIMUM', head_sp, t.math('MAXIMUM', leg_sp, belly_sp)))
    # -------- the tail: broken rings toward the end, a black tip
    tring = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.py, 2.6)), 0.5)),
                     0.13, 0.08)
    tring = t.math('MULTIPLY', tring, t.math('MULTIPLY', t.smooth(t.py, 3.7, 3.95), t.smooth(t.nz, -0.9, -0.5)))
    tipm = t.smooth(t.py, 4.95, 5.05)
    spot_m = t.math('MAXIMUM', spot_m, t.math('MAXIMUM', tring, tipm))
    base = t.mix(t.math('MULTIPLY', spot_m, 0.96), base, srgb(SPOT))
    # -------- face: black lips and lining, pale cheeks under the eyes, nose leather
    H = A.H
    lipz = A.MOUTH['z']
    lips = t.math('MULTIPLY', band(t, t.pz, lipz, 0.035 * A.HK, 0.015),
                  t.math('MULTIPLY', t.smooth(t.py, A.MOUTH['y_corner'] + 0.05, A.MOUTH['y_corner'] - 0.05),
                         t.smooth(ax, 0.42, 0.36)))
    eyes = []
    for s in (1, -1):
        e = np.asarray(A._m(A.EYE, s))
        dd = t.vmath('DISTANCE', P, tuple(e))
        eyes.append([o for o in dd.node.outputs if o.name == 'Value'][0])
    de = t.math('MINIMUM', eyes[0], eyes[1])
    lining = band(t, de, A.EYE_R + 0.03, 0.032, 0.01)
    under_eye = t.math('MULTIPLY', between(t, de, A.EYE_R + 0.05, A.EYE_R + 0.14, 0.03), t.smooth(t.pz, 4.08, 3.95))
    base = t.mix(t.math('MULTIPLY', under_eye, 0.3), base, srgb(CREAM))
    nose_c = H((0, -4.9, 3.88))
    dn = t.vmath('DISTANCE', P, tuple(nose_c))
    dn = [o for o in dn.node.outputs if o.name == 'Value'][0]
    nose = t.math('MULTIPLY', t.smooth(dn, 0.115, 0.085), t.smooth(t.ny, -0.2, -0.6))
    base = t.mix(nose, base, srgb((0.2, 0.1, 0.085)))
    base = t.mix(t.math('MAXIMUM', lips, lining), base, srgb((0.05, 0.035, 0.03)))
    # ears: black backs, pale fur inside
    ear_zone = t.math('MULTIPLY', t.smooth(t.pz, 4.25, 4.4), head)
    ear_back = t.math('MULTIPLY', ear_zone, t.smooth(t.ny, -0.05, 0.35))
    ear_in = t.math('MULTIPLY', ear_zone, t.smooth(t.ny, -0.2, -0.55))
    base = t.mix(ear_back, base, srgb((0.06, 0.045, 0.035)))
    base = t.mix(t.math('MULTIPLY', ear_in, 0.8), base, srgb((0.9, 0.82, 0.68)))
    color = cavity(t, base, dark=0.62, light=1.06, lo=0.46, hi=0.55)
    rough = t.math('ADD', 0.72, t.math('MULTIPLY', t.noise(scale=6, detail=2), 0.12))
    rough = t.fmix(t.math('MAXIMUM', nose, lips), rough, 0.42)
    # -------- Sunbone war paint (bone white and red ochre, chipped)
    for s in (1, -1):
        c = np.array((0.98 * s, -2.02, 2.42))
        dd = t.vmath('DISTANCE', P, tuple(c))
        dd = [o for o in dd.node.outputs if o.name == 'Value'][0]
        side = t.smooth(t.math('MULTIPLY', t.nx, float(s)), 0.25, 0.55)
        disc = t.math('MULTIPLY', side, t.smooth(dd, 0.24, 0.2))
        ringp = t.math('MULTIPLY', side, band(t, dd, 0.32, 0.035, 0.012))
        angp = t.math('ARCTAN2', t.math('SUBTRACT', t.pz, c[2]), t.math('SUBTRACT', t.py, c[1]))
        rays = t.smooth(t.math('SINE', t.math('MULTIPLY', angp, 9.0)), 0.55, 0.8)
        rays = t.math('MULTIPLY', rays, t.math('MULTIPLY', between(t, dd, 0.4, 0.62, 0.02), side))
        color, rough = paint(t, color, rough, disc, BONEPAINT, 16.0)
        color, rough = paint(t, color, rough, t.math('MAXIMUM', ringp, rays), RED, 16.0)
        # three red tally slashes on each haunch
        for k in range(3):
            a = np.array((0.95 * s, 1.45 + 0.17 * k, 2.95))
            b = np.array((0.98 * s, 1.75 + 0.17 * k, 2.35))
            sl = t.math('MULTIPLY', t.smooth(seg_dist(t, P, a, b), 0.045, 0.03), side)
            color, rough = paint(t, color, rough, sl, RED, 16.0)
        # a bone-white bar under each eye down the jowl
        a, b = H((0.29 * s, -4.5, 3.93)), H((0.38 * s, -4.36, 3.7))
        bar = t.smooth(seg_dist(t, P, a, b), 0.035, 0.022)
        color, rough = paint(t, color, rough, bar, BONEPAINT, 20.0)
    # red chevrons on the forehead
    for k in range(3):
        y0 = -4.18 - 0.1 * k
        for s in (1, -1):
            a, b = H((0.0, y0 - 0.08, 4.28)), H((0.17 * s, y0 + 0.04, 4.22))
            ch = t.math('MULTIPLY', t.smooth(seg_dist(t, P, a, b), 0.026, 0.016), t.smooth(t.nz, 0.3, 0.6))
            color, rough = paint(t, color, rough, ch, RED, 20.0)
    # -------- scars: pale, hairless, a little shiny
    sc = None
    for line in A.SCAR_LINES:
        dd = polyline_dist(t, P, line)
        sc = dd if sc is None else t.math('MINIMUM', sc, dd)
    scar = t.smooth(sc, 0.03, 0.012)
    color = t.mix(t.math('MULTIPLY', scar, 0.9), color, srgb(SCAR))
    rough = t.fmix(scar, rough, 0.45)
    # -------- fur relief: strands combed back on the body, down the legs
    strands_b = t.noise(t.scale_vec(46, 7, 46), scale=1.0, detail=3, rough=0.6)
    strands_l = t.noise(t.scale_vec(46, 46, 7), scale=1.0, detail=3, rough=0.6)
    strands = t.fmix(t.math('MAXIMUM', legs, head), strands_b, strands_l)
    clumps = t.noise(t.scale_vec(9, 3, 9), scale=1.0, detail=2)
    h = t.math('ADD', t.math('MULTIPLY', strands, 0.6), t.math('MULTIPLY', clumps, 0.5))
    h = t.math('MULTIPLY', h, t.math('SUBTRACT', 1.0, t.math('MAXIMUM', t.math('MAXIMUM', nose, lips), scar)))
    color = t.mix(t.math('MULTIPLY', t.smooth(strands, 0.62, 0.75), 0.18), color,
                  t.mix(1.0, color, srgb((1.18, 1.12, 1.0)), 'MULTIPLY'))
    t.finish(color, rough, 0.0, t.bump(h, 0.32, 0.008))


def shade(mat, kind):
    t = NT(mat)
    k = kind
    if k == 'skin':
        fur(t)
    elif k == 'bone':
        base = t.ramp(t.noise(scale=9, detail=3), [(0.3, srgb((0.62, 0.55, 0.42))), (0.7, srgb((0.86, 0.8, 0.66)))])
        stain = t.smooth(t.noise(scale=4.5, detail=4, w=1.0), 0.55, 0.72)
        base = t.mix(t.math('MULTIPLY', stain, 0.55), base, srgb((0.45, 0.32, 0.18)))
        cr = t.smooth(t.voronoi(t.scale_vec(1, 1, 2.5), scale=16, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', cr, 0.7), base, srgb((0.25, 0.17, 0.1)))
        color = cavity(t, base, dark=0.42, light=1.12)
        rough = t.math('ADD', 0.48, t.math('MULTIPLY', t.noise(scale=10, detail=2), 0.2))
        # carved grooves dipped in red ochre on some pieces
        grooves = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.pz, 14.0)), 0.5)),
                           0.07, 0.03)
        pick = t.smooth(t.noise(scale=1.3, detail=1, w=3.0), 0.5, 0.56)
        color, rough = paint(t, color, rough, t.math('MULTIPLY', grooves, pick), RED, 30.0)
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=60, detail=3), 0.3), t.math('MULTIPLY', cr, -1.0))
        h = t.math('SUBTRACT', h, t.math('MULTIPLY', t.math('MULTIPLY', grooves, pick), 0.6))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'tooth':
        base = t.ramp(t.math('ADD', t.math('MULTIPLY', t.noise(scale=14, detail=3), 0.5),
                             t.math('MULTIPLY', t.smooth(t.point, 0.5, 0.58), 0.5)),
                      [(0.3, srgb((0.7, 0.62, 0.46))), (0.75, srgb((0.95, 0.91, 0.8)))])
        cr = t.smooth(t.voronoi(t.scale_vec(1, 1, 3), scale=22, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', cr, 0.5), base, srgb((0.4, 0.3, 0.18)))
        t.finish(cavity(t, base, dark=0.5, light=1.08), 0.3, 0.0, t.bump(t.math('ADD', cr, t.noise(scale=120)), 0.12, 0.003))
    elif k == 'claw':
        streak = t.noise(t.scale_vec(30, 30, 3), scale=1.0, detail=3)
        tipv = t.smooth(t.pz, 0.12, -0.02)
        base = t.ramp(streak, [(0.3, srgb((0.16, 0.13, 0.1))), (0.7, srgb((0.32, 0.27, 0.21)))])
        base = t.mix(t.math('MULTIPLY', tipv, 0.85), base, srgb((0.82, 0.78, 0.68)))
        color = cavity(t, base, dark=0.5, light=1.2)
        t.finish(color, 0.32, 0.0, t.bump(streak, 0.25, 0.004))
    elif k == 'eye':
        import anatomy as A
        cx = t.node('ShaderNodeCombineXYZ')
        t.link(t.math('ABSOLUTE', t.px), cx.inputs[0])
        t.link(t.py, cx.inputs[1])
        t.link(t.pz, cx.inputs[2])
        rel = t.vmath('SUBTRACT', cx.outputs[0], tuple(A.EYE))
        nrm = t.vmath('NORMALIZE', rel)
        g = np.asarray(A.EYE_DIR, float)
        front = t.vmath('DOT_PRODUCT', nrm, tuple(g))
        fr = [s for s in front.node.outputs if s.name == 'Value'][0]
        iris = t.smooth(fr, 0.42, 0.52)
        streaks = t.noise(t.scale_vec(60, 60, 60), scale=1.0, detail=3)
        irc = t.ramp(t.math('ADD', t.math('MULTIPLY', streaks, 0.6), t.math('MULTIPLY', t.smooth(fr, 0.55, 0.95), 0.5)),
                     [(0.25, srgb((0.55, 0.32, 0.03))), (0.55, srgb((0.95, 0.68, 0.12))), (0.85, srgb((0.98, 0.86, 0.35)))])
        color = t.mix(iris, srgb((0.05, 0.035, 0.02)), irc)
        limb = t.math('MULTIPLY', band(t, fr, 0.5, 0.05), 0.85)
        color = t.mix(limb, color, srgb((0.18, 0.07, 0.01)))
        pupil = t.smooth(fr, 0.86, 0.9)
        color = t.mix(pupil, color, srgb((0.005, 0.005, 0.005)))
        t.finish(color, 0.04, 0.0)
    elif k == 'mouth':
        base = t.ramp(t.noise(scale=18), [(0.3, srgb((0.22, 0.05, 0.05))), (0.7, srgb((0.46, 0.14, 0.13)))])
        ridges = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.py, 22.0)), 0.5)),
                          0.12, 0.05)
        base = t.mix(t.math('MULTIPLY', ridges, 0.4), base, srgb((0.12, 0.03, 0.03)))
        t.finish(base, 0.28, 0.0, t.bump(t.math('ADD', ridges, t.noise(scale=90)), 0.2, 0.003))
    elif k == 'whisker':
        t.finish(srgb((0.86, 0.84, 0.78)), 0.4, 0.0)
    elif k == 'jade':
        v = t.noise(scale=7, detail=6, rough=0.65, dist=0.6)
        base = t.ramp(v, [(0.3, srgb((0.03, 0.22, 0.13))), (0.55, srgb((0.12, 0.55, 0.34))), (0.8, srgb((0.55, 0.88, 0.66)))])
        vein = t.smooth(t.voronoi(scale=11, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', vein, 0.6), base, srgb((0.8, 0.95, 0.85)))
        t.finish(cavity(t, base, dark=0.5, light=1.15), 0.18, 0.0, t.bump(t.noise(scale=80), 0.08, 0.002))
    elif k in ('leather', 'rope'):
        if k == 'leather':
            base = t.ramp(t.noise(scale=8, detail=5), [(0.35, srgb((0.17, 0.1, 0.06))), (0.65, srgb((0.3, 0.19, 0.11)))])
            scuff = t.smooth(t.noise(t.scale_vec(12, 12, 50), scale=1.0, detail=3), 0.6, 0.68)
            base = t.mix(t.math('MULTIPLY', scuff, 0.6), base, srgb((0.45, 0.32, 0.2)))
            # a red zigzag tooled along the leather
            zig = t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.math('ADD', t.px, t.py), 7.0)), 0.5))
            zz = band(t, t.math('ADD', t.pz, t.math('MULTIPLY', zig, 0.06)), 0.0, 0.012, 0.004)
            del zz
            color = cavity(t, base, dark=0.5, light=1.15)
            rough = t.math('ADD', 0.5, t.math('MULTIPLY', t.noise(scale=8, detail=2), 0.25))
            h = t.math('ADD', t.math('MULTIPLY', t.voronoi(scale=70, feature='DISTANCE_TO_EDGE'), 0.8),
                       t.math('MULTIPLY', scuff, 0.4))
            t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
        else:
            base = t.ramp(t.noise(scale=20, detail=3), [(0.3, srgb((0.34, 0.27, 0.17))), (0.7, srgb((0.5, 0.42, 0.28)))])
            fib = t.noise(t.scale_vec(60, 60, 60), scale=4.0, detail=4)
            color = t.mix(t.math('MULTIPLY', t.smooth(fib, 0.55, 0.7), 0.4), base, srgb((0.6, 0.53, 0.38)))
            t.finish(color, 0.9, 0.0, t.bump(fib, 0.35, 0.003))
    else:
        raise ValueError(kind)
    return mat


def bake_materials():
    return {k: shade(bpy.data.materials.new('Bake_' + k), k) for k in KINDS}


# ------------------------------------------------------------------ uv
def unwrap(objs, scale_fn=None, margin=0.0035):
    """One shared UV atlas over many low objects: smart project, equalize texel
    density, then let `scale_fn(obj, face_center) -> float` boost islands (the
    face, the eye and the hands get more texels), and pack."""
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(52), island_margin=margin, area_weight=0.0,
                             scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    if scale_fn is not None:
        import bmesh
        for o in objs:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            uv = bm.loops.layers.uv.active
            # islands: flood over shared UV coordinates
            seen = set()
            for f in bm.faces:
                if f.index in seen:
                    continue
                stack, island = [f], []
                seen.add(f.index)
                while stack:
                    g = stack.pop()
                    island.append(g)
                    for e in g.edges:
                        for h in e.link_faces:
                            if h.index in seen:
                                continue
                            # same island if the UVs agree across the edge
                            ok = True
                            for v in e.verts:
                                a = [lp[uv].uv for lp in g.loops if lp.vert == v][0]
                                b = [lp[uv].uv for lp in h.loops if lp.vert == v][0]
                                if (a - b).length > 1e-5:
                                    ok = False
                            if ok:
                                seen.add(h.index)
                                stack.append(h)
                c = sum((g.calc_center_median() for g in island), start=island[0].calc_center_median() * 0) / len(island)
                k = scale_fn(o, c)
                if abs(k - 1.0) > 1e-3:
                    uvs = [lp[uv] for g in island for lp in g.loops]
                    cen = sum((l.uv for l in uvs), start=uvs[0].uv * 0) / len(uvs)
                    for l in uvs:
                        l.uv = cen + (l.uv - cen) * k
            bm.to_mesh(o.data)
            bm.free()
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    try:
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin_method='FRACTION', margin=margin,
                                shape_method='CONCAVE', scale=True)
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


# ------------------------------------------------------------------ bake
def bake_all(highs, low, size=4096, samples=64, cage=0.05, ray=0.35, out_dir=None):
    """Bake every pass selected-to-active from `highs` onto the joined `low`.
    Returns numpy arrays (albedo, normal, rough, metal, ao), each (size, size, 4)."""
    from stage import use_gpu
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    print('BAKE_DEVICE', use_gpu(scene))
    scene.cycles.samples = samples
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = cage
    scene.render.bake.max_ray_distance = ray
    scene.render.bake.margin = 8
    scene.render.bake.use_clear = True
    # Only the highs may occlude or be hit: hide every other object from the
    # render, and make the low itself invisible to rays (else the occlusion pass
    # sees the low skin hovering over the high one and goes black in patches).
    hidden = []
    for o in scene.objects:
        if o is low or o in highs or o.hide_render:
            continue
        o.hide_render = True
        hidden.append(o)
    for attr in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission',
                 'visible_volume_scatter', 'visible_shadow'):
        setattr(low, attr, False)
    target = bpy.data.materials.new('BakeTarget')
    target.use_nodes = True
    low.data.materials.clear()
    low.data.materials.append(target)
    node = target.node_tree.nodes.new('ShaderNodeTexImage')
    target.node_tree.nodes.active = node
    results = {}

    def run(name, btype, colorspace='sRGB', **kw):
        img = bpy.data.images.new(f'Jaguar_{name}', size, size, alpha=False, float_buffer=(name == 'normal'))
        img.colorspace_settings.name = colorspace
        node.image = img
        for o in bpy.context.selected_objects:
            o.select_set(False)
        for h in highs:
            h.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        bpy.ops.object.bake(type=btype, **kw)
        a = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
        results[name] = a
        if out_dir:
            img.filepath_raw = os.path.join(out_dir, f'jaguar_{name}_raw.png')
            img.file_format = 'PNG'
            img.save()
        print('BAKED', name, a[..., :3].mean(axis=(0, 1)))
        return img

    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    scene.cycles.samples = 16
    run('albedo', 'DIFFUSE', pass_filter={'COLOR'})
    run('rough', 'ROUGHNESS', 'Non-Color')
    # metallic: route each high's metal signal through emission for one pass
    saved = []
    for h in highs:
        for slot in h.material_slots:
            m = slot.material
            if m is None or 'METAL_EMIT' not in m.node_tree.nodes:
                continue
            nt = m.node_tree
            out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
            prev = out.inputs['Surface'].links[0].from_socket
            nt.links.new(nt.nodes['METAL_EMIT'].outputs[0], out.inputs['Surface'])
            saved.append((nt, prev, out))
    run('metal', 'EMIT', 'Non-Color')
    for nt, prev, out in saved:
        nt.links.new(prev, out.inputs['Surface'])
    scene.cycles.samples = 8
    run('normal', 'NORMAL', 'Non-Color', normal_space='TANGENT')
    scene.cycles.samples = samples
    scene.world = scene.world or bpy.data.worlds.new('bakeworld')
    scene.world.light_settings.distance = 0.9
    run('ao', 'AO', 'Non-Color')
    for o in hidden:
        o.hide_render = False
    return results
