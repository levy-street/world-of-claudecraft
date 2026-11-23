"""Balgath's surfaces: procedural bake shaders per kind, the UV atlas, and the
high-to-low Cycles bake into one albedo, one tangent normal map and one
roughness/metallic map.

Every kind is shaded on the HIGH meshes in their rest pose (object coordinates are
yards, so a mud line is a height, moss grows where the surface faces the sky,
grime sits where Cycles' pointiness says the surface is concave) and baked
selected-to-active onto the low meshes that ship:

  skin     leathery slate hide, paler belly, darker sun-cured back, warm flesh in
           the creases, pores, fen mud dried to a crust up the legs and the fists
  stone    barrowhide granite: feldspar and mica specks, hairline cracks, lichen,
           moss on every face that looks at the sky, chipped pale edges
  leather  dark cracked belt leather with scuffs
  hide     the tanned apron hide, stained and mud-hemmed
  iron     black iron with rust blooms and edge wear (metallic)
  rope     fibre with grime in the lay
  tooth    yellowed ivory with brown cracks
  eye      the wet sclera, veined, tinted teal toward the burning iris
  mouth    the dark wet inside of the maw

The glow (the iris) keeps vertex colours on an emissive material named with
`Glow`, which the runtime pins to its emissive band.
"""
import math
import os

import bpy
import numpy as np

KINDS = ('skin', 'stone', 'leather', 'hide', 'iron', 'rope', 'tooth', 'eye', 'mouth')


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
        n.inputs[1].default_value = lo
        n.inputs[2].default_value = hi
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
def shade(mat, kind):
    t = NT(mat)
    k = kind
    if k == 'skin':
        # big value shapes first: darker back and crown, paler belly and chest
        mott = t.noise(scale=0.3, detail=3, rough=0.5)
        base = t.ramp(mott, [(0.3, srgb((0.36, 0.38, 0.34))), (0.7, srgb((0.48, 0.48, 0.42)))])
        warm = t.smooth(t.noise(scale=0.9, detail=2), 0.48, 0.7)
        base = t.mix(t.math('MULTIPLY', warm, 0.35), base, srgb((0.6, 0.45, 0.37)))
        fen = t.smooth(t.noise(scale=0.7, detail=2, w=7.0), 0.5, 0.7)
        base = t.mix(t.math('MULTIPLY', fen, 0.3), base, srgb((0.36, 0.41, 0.31)))
        belly = t.math('MULTIPLY', t.smooth(t.nz, -0.1, -0.6), 0.6)
        belly = t.math('MAXIMUM', belly, t.math('MULTIPLY', t.smooth(t.ny, -0.4, -0.95),
                                                t.math('MULTIPLY', t.smooth(t.pz, 6.2, 7.0), t.smooth(t.pz, 9.8, 8.6))))
        base = t.mix(t.math('MULTIPLY', belly, 0.55), base, srgb((0.64, 0.55, 0.45)))
        dorsal = t.math('MULTIPLY', t.smooth(t.ny, 0.2, 0.9), 0.4)
        base = t.mix(dorsal, base, srgb((0.27, 0.3, 0.28)))
        # painted top light: planes facing the sky catch it, the undersides sink
        top = t.math('MULTIPLY', t.smooth(t.nz, 0.15, 0.95), 0.28)
        base = t.mix(top, base, srgb((0.66, 0.62, 0.53)))
        under = t.math('MULTIPLY', t.smooth(t.nz, -0.3, -0.95), 0.25)
        base = t.mix(under, base, srgb((0.26, 0.24, 0.22)))
        # the hide: an elephant-skin network of creases, warped so it never tiles
        nzv = t.node('ShaderNodeTexNoise')
        nzv.inputs['Scale'].default_value = 3.0
        t.link(t.P, nzv.inputs['Vector'])
        warped = t.vmath('ADD', t.P, t.vmath('MULTIPLY', nzv.outputs['Color'], (0.12, 0.12, 0.12)))
        hide = t.voronoi(warped, scale=7.5, feature='DISTANCE_TO_EDGE')
        crease = t.smooth(hide, 0.05, 0.0)
        hide2 = t.voronoi(warped, scale=21, feature='DISTANCE_TO_EDGE')
        crease2 = t.smooth(hide2, 0.04, 0.0)
        base = t.mix(t.math('MULTIPLY', crease, 0.35), base, srgb((0.22, 0.2, 0.18)))
        base = t.mix(t.math('MULTIPLY', crease2, 0.18), base, srgb((0.25, 0.23, 0.2)))
        # stone breaking through: grey, cracked hide around every slab
        stony = t.node('ShaderNodeAttribute')
        stony.attribute_name = 'Stony'
        sm = t.smooth(stony.outputs['Fac'], 0.05, 0.9)
        cracks_s = t.smooth(t.voronoi(warped, scale=7.5, feature='DISTANCE_TO_EDGE'), 0.045, 0.0)
        base = t.mix(t.math('MULTIPLY', sm, 0.75), base, srgb((0.47, 0.47, 0.45)))
        base = t.mix(t.math('MULTIPLY', t.math('MULTIPLY', sm, cracks_s), 0.7), base, srgb((0.16, 0.16, 0.15)))
        spots = t.smooth(t.voronoi(scale=22, rnd=1.0), 0.045, 0.02)
        base = t.mix(t.math('MULTIPLY', spots, 0.18), base, srgb((0.28, 0.26, 0.23)))
        fold = t.smooth(t.point, 0.47, 0.42)
        base = t.mix(t.math('MULTIPLY', fold, 0.3), base, srgb((0.46, 0.27, 0.23)))
        color = cavity(t, base, dark=0.8, light=1.06, lo=0.45, hi=0.56)
        rough = t.math('ADD', 0.6, t.math('MULTIPLY', t.noise(scale=3, detail=2), 0.14))
        h = t.math('MULTIPLY', t.noise(scale=80, detail=2), 0.25)
        h = t.math('SUBTRACT', h, t.math('MULTIPLY', crease, 0.9))
        h = t.math('SUBTRACT', h, t.math('MULTIPLY', crease2, 0.45))
        h = t.math('SUBTRACT', h, t.math('MULTIPLY', t.math('MULTIPLY', sm, cracks_s), 1.2))
        # fen grime: a soft darkening that climbs from the ground and gathers below the belt
        grime = t.math('MULTIPLY', t.smooth(t.math('ADD', t.pz, t.math('MULTIPLY', t.noise(scale=1.2, detail=3), 1.6)),
                                            6.8, 2.2), 0.55)
        color = t.mix(grime, color, t.mix(1.0, color, srgb((0.62, 0.58, 0.5)), 'MULTIPLY'))
        color, rough, h = apply_mud(t, color, rough, h, mud_mask(t, top=3.4, low=1.6), wet_bias=0.2)
        color, rough, h = moss(t, color, rough, h, amount=0.45, z_min=9.6)
        t.finish(color, rough, 0.0, t.bump(h, 0.42, 0.015))
    elif k == 'stone':
        tone = t.noise(scale=1.3, detail=4)
        base = t.ramp(tone, [(0.3, srgb((0.46, 0.47, 0.46))), (0.7, srgb((0.67, 0.67, 0.63)))])
        cell = t.voronoi(scale=48, out='Color')
        sep = t.node('ShaderNodeSeparateColor')
        t.link(cell, sep.inputs[0])
        r = sep.outputs[0]
        dark = t.smooth(r, 0.9, 0.95)
        light = t.smooth(r, 0.12, 0.05)
        base = t.mix(t.math('MULTIPLY', dark, 0.6), base, srgb((0.14, 0.14, 0.14)))
        base = t.mix(t.math('MULTIPLY', light, 0.7), base, srgb((0.82, 0.8, 0.75)))
        crack = t.voronoi(t.scale_vec(1, 1, 1.4), scale=3.2, feature='DISTANCE_TO_EDGE')
        crack_l = t.smooth(crack, 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', crack_l, 0.8), base, srgb((0.12, 0.12, 0.11)))
        lich = t.smooth(t.noise(scale=4.5, detail=4), 0.62, 0.66)
        base = t.mix(t.math('MULTIPLY', lich, 0.75), base, srgb((0.66, 0.67, 0.46)))
        lich2 = t.smooth(t.noise(scale=6.5, detail=3, w=3.0), 0.7, 0.73)
        base = t.mix(t.math('MULTIPLY', lich2, 0.8), base, srgb((0.68, 0.45, 0.18)))
        color = cavity(t, base, dark=0.6, light=1.18)
        rough = t.math('ADD', 0.78, t.math('MULTIPLY', t.noise(scale=5, detail=2), 0.15))
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=30, detail=4), 0.5), t.math('MULTIPLY', crack, 2.5))
        h = t.math('SUBTRACT', h, t.math('MULTIPLY', dark, 0.2))
        color, rough, h = moss(t, color, rough, h, amount=1.0)
        color, rough, h = apply_mud(t, color, rough, h, mud_mask(t, top=4.2, low=2.8))
        t.finish(color, rough, 0.0, t.bump(h, 0.35, 0.02))
    elif k in ('leather', 'hide'):
        if k == 'leather':
            c0, c1, c2 = srgb((0.2, 0.12, 0.07)), srgb((0.3, 0.19, 0.11)), srgb((0.42, 0.3, 0.19))
        else:
            c0, c1, c2 = srgb((0.28, 0.19, 0.12)), srgb((0.44, 0.33, 0.21)), srgb((0.56, 0.45, 0.31))
        base = t.ramp(t.noise(scale=2.2, detail=5), [(0.35, c0), (0.65, c1)])
        scuff = t.smooth(t.noise(t.scale_vec(5, 5, 26), scale=1.0, detail=3), 0.6, 0.68)
        base = t.mix(t.math('MULTIPLY', scuff, 0.6), base, c2)
        patch = t.smooth(t.voronoi(scale=1.4, feature='DISTANCE_TO_EDGE'), 0.025, 0.0)
        base = t.mix(t.math('MULTIPLY', patch, 0.8), base, srgb((0.1, 0.06, 0.035)))
        color = cavity(t, base, dark=0.5, light=1.15)
        rough = t.math('ADD', 0.55, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.25))
        h = t.math('ADD', t.math('MULTIPLY', t.voronoi(scale=34, feature='DISTANCE_TO_EDGE'), 0.8),
                   t.math('MULTIPLY', scuff, 0.4))
        h = t.math('ADD', h, t.math('MULTIPLY', patch, -1.0))
        color, rough, h = apply_mud(t, color, rough, h, mud_mask(t, top=5.0 if k == 'hide' else 4.4, low=3.9))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.01))
    elif k == 'iron':
        base = srgb((0.11, 0.11, 0.12))
        rust_n = t.noise(scale=3.5, detail=8, rough=0.7)
        rust = t.math('MAXIMUM', t.smooth(rust_n, 0.5, 0.64), t.smooth(t.point, 0.48, 0.42))
        rust_c = t.ramp(t.noise(scale=12, detail=3), [(0.3, srgb((0.22, 0.08, 0.035))), (0.7, srgb((0.48, 0.22, 0.07)))])
        color = t.mix(rust, base, rust_c)
        wear = t.smooth(t.point, 0.53, 0.6)
        color = t.mix(t.math('MULTIPLY', wear, t.math('SUBTRACT', 1.0, rust)), color, srgb((0.42, 0.42, 0.43)))
        rough = t.fmix(rust, 0.4, 0.92)
        rough = t.fmix(t.math('MULTIPLY', wear, 0.8), rough, 0.25)
        metal = t.fmix(rust, 0.92, 0.12)
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=40, detail=4), rust), t.math('MULTIPLY', rust, 0.5))
        color, rough, h = apply_mud(t, color, rough, h, mud_mask(t, top=4.4, low=3.5), wet_bias=0.8)
        t.finish(color, rough, metal, t.bump(h, 0.25, 0.01))
    elif k == 'rope':
        base = t.ramp(t.noise(scale=9, detail=3), [(0.3, srgb((0.34, 0.27, 0.17))), (0.7, srgb((0.5, 0.42, 0.28)))])
        fib = t.noise(t.scale_vec(30, 30, 30), scale=4.0, detail=4)
        color = cavity(t, base, dark=0.35, light=1.1, lo=0.49, hi=0.51)
        color = t.mix(t.math('MULTIPLY', t.smooth(fib, 0.55, 0.7), 0.4), color, srgb((0.6, 0.53, 0.38)))
        h = fib
        rough = 0.9
        color, rough, h = apply_mud(t, color, rough, h, mud_mask(t, top=4.6, low=3.6))
        t.finish(color, rough, 0.0, t.bump(h, 0.35, 0.006))
    elif k == 'tooth':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.52, 0.43, 0.27))), (0.7, srgb((0.74, 0.66, 0.48)))])
        cr = t.smooth(t.voronoi(t.scale_vec(1, 1, 3), scale=9, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', cr, 0.7), base, srgb((0.3, 0.2, 0.1)))
        # stained brown toward the gum line and in the grooves
        root = t.math('MULTIPLY', t.smooth(t.pz, 11.85, 11.62), 0.6)
        base = t.mix(root, base, srgb((0.36, 0.25, 0.14)))
        color = cavity(t, base, dark=0.45, light=1.1)
        t.finish(color, 0.42, 0.0, t.bump(t.math('ADD', cr, t.noise(scale=60)), 0.15, 0.005))
    elif k == 'eye':
        import anatomy as A
        rel = t.vmath('SUBTRACT', t.P, tuple(A.EYE))
        nrm = t.vmath('NORMALIZE', rel)
        sp = t.node('ShaderNodeSeparateXYZ')
        t.link(nrm, sp.inputs[0])
        front = t.math('MULTIPLY', sp.outputs['Y'], -1.0)
        limbus = t.smooth(front, 0.62, 0.8)
        # a yellowed, bloodshot sclera: veins thicken toward the back, fade at the iris
        base = t.ramp(t.noise(scale=9, detail=3), [(0.3, srgb((0.78, 0.72, 0.55))), (0.7, srgb((0.86, 0.82, 0.66)))])
        v1 = t.smooth(t.voronoi(scale=11, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        v2 = t.smooth(t.voronoi(t.scale_vec(1.3, 1.3, 1.3), scale=27, feature='DISTANCE_TO_EDGE'), 0.025, 0.0)
        veins = t.math('MAXIMUM', v1, t.math('MULTIPLY', v2, 0.7))
        reach = t.math('SUBTRACT', 1.0, limbus)
        base = t.mix(t.math('MULTIPLY', veins, reach), base, srgb((0.62, 0.08, 0.06)))
        flush = t.math('MULTIPLY', t.smooth(front, 0.35, -0.2), 0.6)
        base = t.mix(flush, base, srgb((0.55, 0.22, 0.17)))
        color = t.mix(t.math('MULTIPLY', limbus, 0.85), base, srgb((0.05, 0.3, 0.28)))
        t.finish(color, 0.08, 0.0)
    elif k == 'mouth':
        t.finish(t.ramp(t.noise(scale=8), [(0.3, srgb((0.1, 0.025, 0.03))), (0.7, srgb((0.22, 0.05, 0.05)))]), 0.35, 0.0)
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
        img = bpy.data.images.new(f'Balgath_{name}', size, size, alpha=False, float_buffer=(name == 'normal'))
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
            img.filepath_raw = os.path.join(out_dir, f'balgath_{name}_raw.png')
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
