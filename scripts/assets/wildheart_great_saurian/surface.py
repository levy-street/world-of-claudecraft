"""The Great Saurian's surfaces: procedural bake shaders per kind (adapted from
the Balgath kit), the shared UV atlas, and the high-to-low Cycles bake into one
albedo, one tangent normal map and one roughness/metallic map.

Kinds: skin (olive jungle hide, pale belly, dark bands, Sunbone war paint: the sun
on each flank, chevrons down the neck, red rings round the tail, bone-white round
the eyes), scute, moss, fern, bone, nail, tooth, eye, mouth, bamboo, cloth (the
woven blanket and the rider's cloak), banner (the Sunbone sun on dark red),
leather, rope, hide, troll (the rider's skin). The ford's wet line climbs every
leg.
"""
import math
import os

import bpy
import numpy as np

KINDS = ('skin', 'scute', 'moss', 'fern', 'bone', 'nail', 'tooth', 'eye', 'mouth', 'bamboo', 'cloth', 'banner',
         'leather', 'rope', 'hide', 'troll')


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
def mud_mask(t, top=4.6, low=2.9, streak=True):
    """1 below the mud line, ragged and dripping upward in tongues."""
    n = t.noise(scale=1.6, detail=5, rough=0.6)
    z = t.math('ADD', t.pz, t.math('MULTIPLY', t.math('SUBTRACT', n, 0.5), 1.4))
    m = t.math('SUBTRACT', 1.0, t.smooth(z, low, top))
    if streak:
        drip = t.noise(t.scale_vec(6.0, 6.0, 0.45), scale=1.0, detail=2)
        dz = t.smooth(t.pz, top + 1.6, top - 0.2)
        tongue = t.math('MULTIPLY', t.smooth(drip, 0.58, 0.68), t.math('SUBTRACT', 1.0, t.smooth(t.pz, top - 0.3, top + 1.4)))
        m = t.math('MAXIMUM', m, t.math('MULTIPLY', tongue, dz))
        splat = t.smooth(t.noise(scale=6.5, detail=2, w=2.0), 0.66, 0.7)
        m = t.math('MAXIMUM', m, t.math('MULTIPLY', splat, t.smooth(t.pz, top + 2.6, top)))
    return m


def apply_mud(t, color, rough, bump_h, mask, wet_bias=0.5):
    wet = t.math('MULTIPLY', t.smooth(t.noise(scale=2.3, detail=3), 0.5 - wet_bias * 0.3, 0.72 - wet_bias * 0.3), 0.75)
    mud_c = t.mix(wet, srgb((0.43, 0.37, 0.28)), srgb((0.22, 0.17, 0.12)))
    flecks = t.smooth(t.noise(scale=22, detail=2), 0.62, 0.7)
    mud_c = t.mix(t.math('MULTIPLY', flecks, 0.5), mud_c, srgb((0.42, 0.36, 0.26)))
    color = t.mix(mask, color, mud_c)
    mud_r = t.fmix(wet, 0.9, 0.45)
    rough = t.fmix(mask, rough, mud_r)
    crust = t.math('MULTIPLY', t.voronoi(scale=11, feature='DISTANCE_TO_EDGE'), mask)
    bump_h = t.math('ADD', bump_h, t.math('MULTIPLY', crust, 0.6))
    return color, rough, bump_h


def moss(t, color, rough, bump_h, amount=1.0, z_min=-99):
    up = t.smooth(t.nz, 0.18, 0.75)
    patch = t.smooth(t.noise(scale=1.9, detail=6, rough=0.65), 0.46, 0.6)
    m = t.math('MULTIPLY', t.math('MULTIPLY', up, patch), amount)
    if z_min > -99:
        m = t.math('MULTIPLY', m, t.smooth(t.pz, z_min, z_min + 1.5))
    fuzz = t.noise(scale=55, detail=3)
    moss_c = t.mix(t.noise(scale=7, detail=3), srgb((0.13, 0.2, 0.06)), srgb((0.32, 0.4, 0.12)))
    moss_c = t.mix(t.math('MULTIPLY', fuzz, 0.4), moss_c, srgb((0.45, 0.52, 0.2)))
    color = t.mix(m, color, moss_c)
    rough = t.fmix(m, rough, 0.95)
    bump_h = t.math('ADD', bump_h, t.math('MULTIPLY', m, t.math('MULTIPLY', fuzz, 1.2)))
    return color, rough, bump_h


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


def ford_line(t, color, rough, h):
    """The ford: legs wet and silted up to the knee, a darker wet band above."""
    wet = t.math('MULTIPLY', t.smooth(t.math('ADD', t.pz, t.math('MULTIPLY', t.noise(scale=1.4, detail=3), 0.9)),
                                      3.4, 2.4), 0.45)
    color = t.mix(wet, color, t.mix(1.0, color, srgb((0.55, 0.55, 0.5)), 'MULTIPLY'))
    rough = t.fmix(wet, rough, 0.3)
    return apply_mud(t, color, rough, h, mud_mask(t, top=1.9, low=1.0), wet_bias=0.8)


def shade(mat, kind):
    t = NT(mat)
    k = kind
    ax = t.math('ABSOLUTE', t.px)
    anx = t.math('ABSOLUTE', t.nx)
    if k == 'skin':
        mott = t.noise(scale=0.22, detail=3, rough=0.5)
        base = t.ramp(mott, [(0.3, srgb((0.3, 0.3, 0.2))), (0.7, srgb((0.44, 0.41, 0.28)))])
        warm = t.smooth(t.noise(scale=0.6, detail=2, w=4.0), 0.5, 0.72)
        base = t.mix(t.math('MULTIPLY', warm, 0.35), base, srgb((0.5, 0.36, 0.24)))
        dorsal = t.smooth(t.nz, 0.1, 0.8)
        base = t.mix(t.math('MULTIPLY', dorsal, 0.55), base, srgb((0.24, 0.29, 0.16)))
        belly = t.smooth(t.nz, -0.15, -0.7)
        base = t.mix(t.math('MULTIPLY', belly, 0.7), base, srgb((0.62, 0.54, 0.38)))
        # dark bands across the back, the neck and the tail, broken by noise
        stripe_c = t.math('ADD', t.math('MULTIPLY', t.py, 0.36), t.math('MULTIPLY', t.noise(scale=0.8, detail=2), 0.55))
        stripe = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', stripe_c), 0.5)), 0.3, 0.38)
        stripe = t.math('MULTIPLY', stripe, t.smooth(t.nz, -0.25, 0.25))
        base = t.mix(t.math('MULTIPLY', stripe, 0.55), base, srgb((0.15, 0.15, 0.1)))
        # scales: big plates over a pebbled ground, warped so they never tile
        nzv = t.node('ShaderNodeTexNoise')
        nzv.inputs['Scale'].default_value = 2.0
        t.link(t.P, nzv.inputs['Vector'])
        warped = t.vmath('ADD', t.P, t.vmath('MULTIPLY', nzv.outputs['Color'], (0.15, 0.15, 0.15)))
        sc = t.voronoi(warped, scale=3.6, feature='DISTANCE_TO_EDGE')
        crease = t.smooth(sc, 0.06, 0.0)
        sc2 = t.voronoi(warped, scale=11, feature='DISTANCE_TO_EDGE')
        crease2 = t.smooth(sc2, 0.05, 0.0)
        cell = t.voronoi(warped, scale=3.6, out='Color')
        cs = t.node('ShaderNodeSeparateColor')
        t.link(cell, cs.inputs[0])
        base = t.mix(t.math('MULTIPLY', cs.outputs[0], 0.18), base, srgb((0.52, 0.48, 0.34)))
        base = t.mix(t.math('MULTIPLY', crease, 0.5), base, srgb((0.14, 0.13, 0.1)))
        base = t.mix(t.math('MULTIPLY', crease2, 0.25), base, srgb((0.2, 0.18, 0.13)))
        top = t.math('MULTIPLY', t.smooth(t.nz, 0.2, 0.95), 0.2)
        base = t.mix(top, base, srgb((0.58, 0.56, 0.42)))
        under = t.math('MULTIPLY', t.smooth(t.nz, -0.3, -0.95), 0.25)
        base = t.mix(under, base, srgb((0.22, 0.2, 0.16)))
        fold = t.smooth(t.point, 0.47, 0.42)
        base = t.mix(t.math('MULTIPLY', fold, 0.35), base, srgb((0.36, 0.2, 0.15)))
        color = cavity(t, base, dark=0.7, light=1.08, lo=0.45, hi=0.56)
        rough = t.math('ADD', 0.62, t.math('MULTIPLY', t.noise(scale=3, detail=2), 0.14))
        # ---- the Sunbone war paint
        side = t.smooth(anx, 0.35, 0.6)
        d = length2(t, t.py, 0.3, t.pz, 7.3)
        flank = t.math('MULTIPLY', side, t.smooth(ax, 1.9, 2.3))
        disc = t.math('MULTIPLY', flank, t.smooth(d, 0.66, 0.58))
        ring = t.math('MULTIPLY', flank, band(t, d, 0.95, 0.1))
        ang = t.math('ARCTAN2', t.math('SUBTRACT', t.pz, 7.3), t.math('SUBTRACT', t.py, 0.3))
        rays = t.smooth(t.math('SINE', t.math('MULTIPLY', ang, 11.0)),
                        t.fmix(t.smooth(d, 1.2, 2.0), 0.2, 0.85), t.fmix(t.smooth(d, 1.2, 2.0), 0.35, 0.95))
        rays = t.math('MULTIPLY', rays, t.math('MULTIPLY', between(t, d, 1.2, 2.05), flank))
        color, rough = paint(t, color, rough, disc, BONEPAINT)
        color, rough = paint(t, color, rough, t.math('MAXIMUM', ring, rays), RED)
        # chevrons down the neck's sides
        neck = t.math('MULTIPLY', between(t, t.py, -9.0, -4.8, 0.2), t.smooth(anx, 0.25, 0.5))
        chev = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math(
            'ADD', t.math('MULTIPLY', t.py, -0.62), t.math('MULTIPLY', t.pz, 0.25))), 0.5)), 0.08, 0.04)
        color, rough = paint(t, color, rough, t.math('MULTIPLY', neck, chev), RED)
        # red rings round the tail
        tail = t.math('MULTIPLY', t.smooth(t.py, 7.2, 7.8), t.smooth(t.py, 15.6, 15.0))
        rings = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.py, 0.42)), 0.5)),
                         0.07, 0.04)
        color, rough = paint(t, color, rough, t.math('MULTIPLY', tail, rings), RED)
        # bone-white round the eyes and a streak down each cheek
        de = t.math('SQRT', t.math('ADD', t.math('ADD',
                                                 t.math('POWER', t.math('SUBTRACT', ax, 0.94), 2.0),
                                                 t.math('POWER', t.math('ADD', t.py, 10.45), 2.0)),
                                   t.math('POWER', t.math('SUBTRACT', t.pz, 13.9), 2.0)))
        eyep = between(t, de, 0.3, 0.6, 0.04)
        streak = t.math('MULTIPLY', t.math('MULTIPLY', band(t, t.py, -10.45, 0.12), between(t, t.pz, 12.7, 13.75)),
                        t.smooth(anx, 0.4, 0.6))
        color, rough = paint(t, color, rough, t.math('MAXIMUM', eyep, streak), BONEPAINT, 11.0)
        # the inside of the mouth: dark wet gum
        line = t.math('ADD', 13.2, t.math('MULTIPLY', t.math('ADD', t.py, 11.1), 0.09))
        mouth = t.math('MULTIPLY', t.math('MULTIPLY', band(t, t.pz, line, 0.16, 0.04), t.smooth(t.py, -9.7, -10.0)),
                       t.math('MULTIPLY', t.smooth(ax, 0.8, 0.7), t.smooth(t.math('ABSOLUTE', t.nz), 0.45, 0.65)))
        color = t.mix(mouth, color, srgb((0.22, 0.05, 0.05)))
        rough = t.fmix(mouth, rough, 0.3)
        h = t.math('MULTIPLY', t.noise(scale=60, detail=2), 0.2)
        h = t.math('SUBTRACT', h, t.math('MULTIPLY', crease, 1.0))
        h = t.math('SUBTRACT', h, t.math('MULTIPLY', crease2, 0.45))
        color, rough, h = ford_line(t, color, rough, h)
        color, rough, h = moss(t, color, rough, h, amount=0.3, z_min=8.8)
        t.finish(color, rough, 0.0, t.bump(h, 0.45, 0.02))
    elif k == 'scute':
        base = t.ramp(t.noise(scale=1.6, detail=4), [(0.3, srgb((0.2, 0.18, 0.14))), (0.7, srgb((0.34, 0.3, 0.23)))])
        tipc = t.smooth(t.point, 0.52, 0.6)
        base = t.mix(t.math('MULTIPLY', tipc, 0.7), base, srgb((0.6, 0.55, 0.42)))
        crack = t.voronoi(t.scale_vec(1, 1, 1.5), scale=4.5, feature='DISTANCE_TO_EDGE')
        base = t.mix(t.math('MULTIPLY', t.smooth(crack, 0.03, 0.0), 0.7), base, srgb((0.08, 0.07, 0.06)))
        color = cavity(t, base, dark=0.55, light=1.15)
        rough = t.math('ADD', 0.55, t.math('MULTIPLY', t.noise(scale=6, detail=2), 0.2))
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=25, detail=4), 0.4), t.math('MULTIPLY', crack, 2.0))
        color, rough, h = moss(t, color, rough, h, amount=0.7)
        t.finish(color, rough, 0.0, t.bump(h, 0.35, 0.02))
    elif k == 'moss':
        fuzz = t.noise(scale=48, detail=4)
        c1 = t.mix(t.noise(scale=3.5, detail=3), srgb((0.12, 0.2, 0.05)), srgb((0.3, 0.42, 0.1)))
        dry = t.smooth(t.noise(scale=1.4, detail=3, w=2.0), 0.55, 0.7)
        c1 = t.mix(t.math('MULTIPLY', dry, 0.6), c1, srgb((0.5, 0.48, 0.18)))
        c1 = t.mix(t.math('MULTIPLY', fuzz, 0.45), c1, srgb((0.46, 0.56, 0.2)))
        sprout = t.smooth(t.noise(scale=14, detail=2, w=5.0), 0.68, 0.74)
        c1 = t.mix(t.math('MULTIPLY', sprout, 0.6), c1, srgb((0.58, 0.66, 0.24)))
        color = cavity(t, c1, dark=0.45, light=1.12)
        h = t.math('ADD', t.math('MULTIPLY', fuzz, 1.0), t.math('MULTIPLY', t.noise(scale=9, detail=3), 0.6))
        t.finish(color, 0.92, 0.0, t.bump(h, 0.55, 0.02))
    elif k == 'fern':
        c1 = t.mix(t.noise(scale=4, detail=2), srgb((0.12, 0.26, 0.05)), srgb((0.3, 0.48, 0.1)))
        tipc = t.smooth(t.noise(scale=9, detail=2, w=3.0), 0.6, 0.72)
        c1 = t.mix(t.math('MULTIPLY', tipc, 0.5), c1, srgb((0.48, 0.5, 0.16)))
        t.finish(cavity(t, c1, dark=0.6, light=1.1), 0.6, 0.0, t.bump(t.noise(scale=40), 0.15, 0.005))
    elif k == 'bone':
        base = t.ramp(t.noise(scale=4, detail=3), [(0.3, srgb((0.6, 0.53, 0.4))), (0.7, srgb((0.82, 0.76, 0.62)))])
        stain = t.smooth(t.noise(scale=2.2, detail=4, w=1.0), 0.55, 0.72)
        base = t.mix(t.math('MULTIPLY', stain, 0.6), base, srgb((0.42, 0.3, 0.17)))
        cr = t.smooth(t.voronoi(t.scale_vec(1, 1, 2.5), scale=7, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', cr, 0.7), base, srgb((0.25, 0.17, 0.1)))
        color = cavity(t, base, dark=0.42, light=1.12)
        rough = t.math('ADD', 0.5, t.math('MULTIPLY', t.noise(scale=5, detail=2), 0.2))
        # the sun painted on the forehead plate
        dpl = length2(t, t.px, 0.0, t.py, -10.25)
        plate = t.math('MULTIPLY', t.smooth(t.pz, 14.2, 14.45), t.smooth(t.py, -9.3, -9.6))
        sun = t.math('MAXIMUM', band(t, dpl, 0.36, 0.06), t.smooth(dpl, 0.16, 0.12))
        color, rough = paint(t, color, rough, t.math('MULTIPLY', plate, sun), RED, 13.0)
        # the club spikes dipped in red
        spikes = t.math('MULTIPLY', t.smooth(t.py, 15.3, 15.6), t.smooth(t.point, 0.5, 0.56))
        color, rough = paint(t, color, rough, spikes, RED, 13.0)
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=30, detail=3), 0.3), t.math('MULTIPLY', cr, -1.0))
        t.finish(color, rough, 0.0, t.bump(h, 0.25, 0.008))
    elif k == 'nail':
        streak = t.noise(t.scale_vec(14, 14, 1.2), scale=1.0, detail=3)
        base = t.ramp(streak, [(0.3, srgb((0.12, 0.1, 0.08))), (0.7, srgb((0.3, 0.26, 0.2)))])
        color = cavity(t, base, dark=0.5, light=1.25)
        h = t.math('MULTIPLY', streak, 0.6)
        color, rough, h = apply_mud(t, color, 0.45, h, mud_mask(t, top=0.9, low=0.4), wet_bias=0.8)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.01))
    elif k == 'tooth':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.56, 0.48, 0.3))), (0.7, srgb((0.76, 0.69, 0.5)))])
        cr = t.smooth(t.voronoi(t.scale_vec(1, 1, 3), scale=9, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', cr, 0.6), base, srgb((0.3, 0.2, 0.1)))
        t.finish(cavity(t, base, dark=0.45, light=1.1), 0.4, 0.0, t.bump(t.math('ADD', cr, t.noise(scale=60)), 0.15, 0.005))
    elif k == 'eye':
        import anatomy as A
        cx = t.node('ShaderNodeCombineXYZ')
        t.link(ax, cx.inputs[0])
        t.link(t.py, cx.inputs[1])
        t.link(t.pz, cx.inputs[2])
        rel = t.vmath('SUBTRACT', cx.outputs[0], tuple(A.EYE))
        nrm = t.vmath('NORMALIZE', rel)
        g = np.array((1.0, -0.45, 0.12))
        g /= np.linalg.norm(g)
        front = t.vmath('DOT_PRODUCT', nrm, tuple(g))
        fr = [s for s in front.node.outputs if s.name == 'Value'][0]
        eh = np.array((0.45, 1.0, 0.0))
        eh /= np.linalg.norm(eh)
        uh = [s for s in t.vmath('DOT_PRODUCT', nrm, tuple(eh)).node.outputs if s.name == 'Value'][0]
        iris = t.smooth(fr, 0.5, 0.62)
        irc = t.ramp(t.noise(scale=40, detail=3), [(0.3, srgb((0.62, 0.3, 0.04))), (0.7, srgb((0.95, 0.66, 0.15)))])
        color = t.mix(iris, srgb((0.07, 0.05, 0.03)), irc)
        limb = t.math('MULTIPLY', band(t, fr, 0.6, 0.05), 0.7)
        color = t.mix(limb, color, srgb((0.25, 0.08, 0.02)))
        slit = t.math('MULTIPLY', t.smooth(t.math('ABSOLUTE', uh), 0.09, 0.05), t.smooth(fr, 0.7, 0.78))
        color = t.mix(slit, color, srgb((0.01, 0.01, 0.01)))
        t.finish(color, 0.06, 0.0)
    elif k == 'mouth':
        t.finish(t.ramp(t.noise(scale=8), [(0.3, srgb((0.12, 0.03, 0.03))), (0.7, srgb((0.3, 0.07, 0.06)))]), 0.3, 0.0)
    elif k == 'bamboo':
        lg = t.noise(t.scale_vec(10, 10, 10), scale=1.0, detail=3)
        base = t.ramp(lg, [(0.3, srgb((0.5, 0.45, 0.24))), (0.7, srgb((0.7, 0.62, 0.36)))])
        green = t.smooth(t.noise(scale=1.3, detail=2, w=6.0), 0.5, 0.65)
        base = t.mix(t.math('MULTIPLY', green, 0.45), base, srgb((0.42, 0.48, 0.2)))
        color = cavity(t, base, dark=0.35, light=1.15)
        # red ochre wraps under the post tops
        wrap = t.math('MULTIPLY', between(t, t.pz, 13.55, 13.85, 0.02), t.smooth(ax, 1.85, 2.0))
        color = t.mix(wrap, color, srgb(RED))
        h = t.math('MULTIPLY', t.noise(scale=55, detail=2), 0.3)
        t.finish(color, 0.45, 0.0, t.bump(h, 0.2, 0.005))
    elif k in ('cloth', 'banner'):
        weave = t.math('MULTIPLY', t.math('ADD', t.math('SINE', t.math('MULTIPLY', t.px, 260.0)),
                                          t.math('SINE', t.math('MULTIPLY', t.math('ADD', t.py, t.pz), 260.0))), 0.25)
        if k == 'cloth':
            zig = t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.px, 1.1)), 0.5))
            v = t.math('FRACT', t.math('ADD', t.math('MULTIPLY', t.py, 0.75), t.math('MULTIPLY', zig, 0.55)))
            n = t.node('ShaderNodeValToRGB')
            t._in(n, 0, v)
            n.color_ramp.interpolation = 'CONSTANT'
            el = n.color_ramp.elements
            stops = [(0.0, (0.42, 0.07, 0.04)), (0.38, (0.76, 0.5, 0.14)), (0.5, (0.12, 0.08, 0.06)),
                     (0.62, (0.82, 0.76, 0.6)), (0.75, (0.12, 0.08, 0.06)), (0.87, (0.42, 0.07, 0.04))]
            while len(el) < len(stops):
                el.new(0.5)
            for e, (pos, c) in zip(el, stops):
                e.position = pos
                e.color = srgb(c)
            base = n.outputs['Color']
        else:
            base = srgb((0.38, 0.05, 0.035))
            yc, zc = 2.25, 14.75
            dd = length2(t, t.py, yc, t.pz, zc)
            sun = t.smooth(dd, 0.3, 0.26)
            ring = band(t, dd, 0.4, 0.04)
            angb = t.math('ARCTAN2', t.math('SUBTRACT', t.pz, zc), t.math('SUBTRACT', t.py, yc))
            rays = t.math('MULTIPLY', t.smooth(t.math('SINE', t.math('MULTIPLY', angb, 9.0)), 0.5, 0.75),
                          between(t, dd, 0.48, 0.66, 0.02))
            base = t.mix(sun, base, srgb(BONEPAINT))
            base = t.mix(t.math('MAXIMUM', ring, rays), base, srgb(OCHRE))
            topb = t.smooth(t.pz, 15.72, 15.8)
            base = t.mix(topb, base, srgb((0.08, 0.05, 0.04)))
            hem = t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.py, 3.0)), 0.5))
            zz = t.math('ADD', 13.95, t.math('MULTIPLY', hem, 0.3))
            base = t.mix(band(t, t.pz, zz, 0.06, 0.02), base, srgb(BONEPAINT))
        dirt = t.smooth(t.noise(scale=2.0, detail=4), 0.5, 0.75)
        base = t.mix(t.math('MULTIPLY', dirt, 0.45), base, srgb((0.2, 0.16, 0.11)))
        color = cavity(t, base, dark=0.55, light=1.08)
        t.finish(color, 0.88, 0.0, t.bump(t.math('ADD', weave, t.math('MULTIPLY', t.noise(scale=12), 0.4)), 0.25, 0.006))
    elif k in ('leather', 'hide'):
        if k == 'leather':
            c0, c1, c2 = srgb((0.2, 0.12, 0.07)), srgb((0.3, 0.19, 0.11)), srgb((0.42, 0.3, 0.19))
        else:
            c0, c1, c2 = srgb((0.36, 0.26, 0.16)), srgb((0.52, 0.4, 0.26)), srgb((0.64, 0.52, 0.36))
        base = t.ramp(t.noise(scale=2.2, detail=5), [(0.35, c0), (0.65, c1)])
        scuff = t.smooth(t.noise(t.scale_vec(5, 5, 26), scale=1.0, detail=3), 0.6, 0.68)
        base = t.mix(t.math('MULTIPLY', scuff, 0.6), base, c2)
        patch = t.smooth(t.voronoi(scale=1.4, feature='DISTANCE_TO_EDGE'), 0.025, 0.0)
        base = t.mix(t.math('MULTIPLY', patch, 0.8), base, srgb((0.1, 0.06, 0.035)))
        color = cavity(t, base, dark=0.5, light=1.15)
        rough = t.math('ADD', 0.55, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.25))
        if k == 'hide':
            # the shields' painted sun, and red zigzag bands on the canopy
            ds = length2(t, t.py, -0.3, t.pz, 11.9)
            shield = t.math('MULTIPLY', t.smooth(ax, 2.25, 2.33), t.math('MAXIMUM', band(t, ds, 0.34, 0.05),
                                                                         t.smooth(ds, 0.15, 0.11)))
            color, rough = paint(t, color, rough, shield, RED, 12.0)
            zig = t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.py, 1.6)), 0.5))
            cz = t.math('ADD', 14.1, t.math('MULTIPLY', zig, 0.25))
            canopy = t.math('MULTIPLY', band(t, t.pz, cz, 0.05, 0.02), t.smooth(t.pz, 13.85, 13.95))
            color, rough = paint(t, color, rough, canopy, RED, 12.0)
        h = t.math('ADD', t.math('MULTIPLY', t.voronoi(scale=34, feature='DISTANCE_TO_EDGE'), 0.8),
                   t.math('MULTIPLY', scuff, 0.4))
        h = t.math('ADD', h, t.math('MULTIPLY', patch, -1.0))
        color, rough, h = apply_mud(t, color, rough, h, mud_mask(t, top=2.0, low=1.0, streak=False))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.01))
    elif k == 'rope':
        base = t.ramp(t.noise(scale=9, detail=3), [(0.3, srgb((0.34, 0.27, 0.17))), (0.7, srgb((0.5, 0.42, 0.28)))])
        fib = t.noise(t.scale_vec(30, 30, 30), scale=4.0, detail=4)
        color = cavity(t, base, dark=0.35, light=1.1, lo=0.49, hi=0.51)
        color = t.mix(t.math('MULTIPLY', t.smooth(fib, 0.55, 0.7), 0.4), color, srgb((0.6, 0.53, 0.38)))
        t.finish(color, 0.9, 0.0, t.bump(fib, 0.35, 0.006))
    elif k == 'troll':
        base = t.ramp(t.noise(scale=3, detail=3), [(0.3, srgb((0.18, 0.36, 0.34))), (0.7, srgb((0.3, 0.5, 0.44)))])
        stripes = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.pz, 4.0)), 0.5)),
                           0.08, 0.04)
        arms = t.smooth(ax, 0.35, 0.45)
        color = cavity(t, base, dark=0.55, light=1.1)
        color, rough = paint(t, color, 0.55, t.math('MULTIPLY', stripes, arms), BONEPAINT, 20.0)
        t.finish(color, rough, 0.0, t.bump(t.noise(scale=40), 0.15, 0.005))
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
        img = bpy.data.images.new(f'Saurian_{name}', size, size, alpha=False, float_buffer=(name == 'normal'))
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
            img.filepath_raw = os.path.join(out_dir, f'saurian_{name}_raw.png')
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
