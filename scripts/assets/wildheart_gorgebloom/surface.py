"""The Gorgebloom's surfaces: procedural bake shaders per kind (adapted from the
Great Jaguar kit), the shared UV atlas, and the high-to-low Cycles bake into one
albedo, one tangent normal map, one roughness/metallic map and one GLOW
(emissive) map.

The plant skin is painted by ZONES the sculpt itself wrote onto the high mesh
(three colour attributes, see anatomy.ZONES): the waxy olive bulb flesh with
crimson veins and a slime line at the water, the red petals with their pale
warts and a wine-dark throat, the golden pollen sacs (self-lit), the wet purple
lips, the gullet glowing sickly yellow-green in its depth, the bark of the
roots, the leathery bracts and sepals.

Kinds: plant, vine, tooth (thorn-teeth and barbs, ivory to blood-dark tips via
the part's vertex colour), bone, cloth (prisoners' rags), iron (a shackle).
"""
import math
import os

import bpy
import numpy as np

import anatomy as A

KINDS = ('plant', 'vine', 'tooth', 'bone', 'cloth', 'iron')


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
        self.glow = None
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
        # the self-lit glow (the gullet, the pollen sacs) for the GLOW bake
        gl = self.node('ShaderNodeEmission')
        gl.name = 'GLOW_EMIT'
        self._in(gl, 'Color', self.glow if self.glow is not None else (0.0, 0.0, 0.0, 1.0))
        gl.inputs['Strength'].default_value = 1.0


# ------------------------------------------------------------------ shared masks

def cavity(t, color, dark=0.55, light=1.12, lo=0.47, hi=0.53):
    concave = t.smooth(t.point, lo, lo - 0.08)
    convex = t.smooth(t.point, hi, hi + 0.08)
    color = t.mix(concave, color, t.mix(1.0, color, srgb((dark * 0.6, dark * 0.55, dark * 0.5)), 'MULTIPLY'))
    color = t.mix(t.math('MULTIPLY', convex, 0.6), color, t.mix(1.0, color, srgb((light, light, light * 0.97)), 'MULTIPLY'))
    return color



# ------------------------------------------------------------------ helpers
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


# ------------------------------------------------------------------ kinds
def cavity(t, color, dark=0.55, light=1.12, lo=0.47, hi=0.53):
    concave = t.smooth(t.point, lo, lo - 0.08)
    convex = t.smooth(t.point, hi, hi + 0.08)
    color = t.mix(concave, color, t.mix(1.0, color, srgb((dark * 0.6, dark * 0.55, dark * 0.5)), 'MULTIPLY'))
    color = t.mix(t.math('MULTIPLY', convex, 0.6), color,
                  t.mix(1.0, color, srgb((light, light, light * 0.97)), 'MULTIPLY'))
    return color


def attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_type = 'GEOMETRY'
    n.attribute_name = name
    sep = t.node('ShaderNodeSeparateColor')
    t.link(n.outputs['Color'], sep.inputs[0])
    return sep.outputs[0], sep.outputs[1], sep.outputs[2], n.outputs['Alpha']


def dist_to(t, p):
    dd = t.vmath('DISTANCE', t.P, tuple(float(x) for x in p))
    return [o for o in dd.node.outputs if o.name == 'Value'][0]


def plant(t):
    petal, sac, lip, gullet = attr(t, 'ZoneA')
    root, bract, sepal, wart = attr(t, 'ZoneB')
    vein, _, _, _ = attr(t, 'ZoneC')
    z = t.pz
    # -------- bulb flesh: waxy olive, mottled, a purple blush up toward the neck
    mott = t.noise(scale=0.9, detail=4, rough=0.6)
    base = t.ramp(mott, [(0.3, srgb((0.11, 0.15, 0.05))), (0.55, srgb((0.22, 0.28, 0.09))),
                         (0.78, srgb((0.34, 0.37, 0.12)))])
    speck = t.smooth(t.voronoi(scale=5.0, feature='F1'), 0.12, 0.06)
    base = t.mix(t.math('MULTIPLY', speck, 0.5), base, srgb((0.42, 0.42, 0.16)))
    blush = t.math('MULTIPLY', t.smooth(z, 4.2, 6.8), 0.65)
    base = t.mix(blush, base, srgb((0.3, 0.07, 0.1)))
    net = t.smooth(t.voronoi(t.scale_vec(1.0, 1.0, 0.45), scale=2.2, feature='DISTANCE_TO_EDGE'), 0.05, 0.0)
    base = t.mix(t.math('MULTIPLY', net, 0.55), base, srgb((0.2, 0.04, 0.08)))
    base = t.mix(t.math('MULTIPLY', vein, 0.9), base, srgb((0.25, 0.03, 0.08)))
    rough = t.math('ADD', 0.42, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.15))
    # -------- roots: dark wet bark, moss
    fib = t.noise(t.scale_vec(14, 14, 3), scale=1.0, detail=4)
    bark = t.ramp(fib, [(0.35, srgb((0.06, 0.04, 0.03))), (0.65, srgb((0.2, 0.14, 0.08)))])
    moss = t.smooth(t.noise(scale=1.6, detail=4, w=2.0), 0.55, 0.66)
    bark = t.mix(t.math('MULTIPLY', moss, 0.8), bark, srgb((0.12, 0.2, 0.05)))
    base = t.mix(root, base, bark)
    rough = t.fmix(root, rough, 0.8)
    # -------- bracts and sepals: leathery leaves, red-purple tips and edges
    lv = t.noise(t.scale_vec(3, 3, 16), scale=1.0, detail=3)
    leaf = t.ramp(lv, [(0.3, srgb((0.08, 0.12, 0.04))), (0.7, srgb((0.18, 0.24, 0.07)))])
    tipr = t.math('MAXIMUM', t.smooth(z, 2.6, 3.6), t.smooth(t.point, 0.53, 0.6))
    leaf = t.mix(t.math('MULTIPLY', tipr, 0.8), leaf, srgb((0.32, 0.05, 0.08)))
    leaf_m = t.math('MAXIMUM', bract, sepal)
    base = t.mix(leaf_m, base, leaf)
    rough = t.fmix(leaf_m, rough, 0.55)
    # -------- petals: deep red, a wine-dark throat, pale warts and speckles
    pn = t.noise(scale=1.4, detail=5, rough=0.6)
    red = t.ramp(pn, [(0.3, srgb((0.36, 0.02, 0.03))), (0.55, srgb((0.62, 0.05, 0.04))),
                      (0.8, srgb((0.78, 0.13, 0.07)))])
    throat = t.smooth(dist_to(t, A.HC), 3.0, 1.9)
    red = t.mix(t.math('MULTIPLY', throat, 0.85), red, srgb((0.16, 0.01, 0.03)))
    rvein = t.smooth(t.voronoi(scale=3.5, feature='DISTANCE_TO_EDGE'), 0.035, 0.0)
    red = t.mix(t.math('MULTIPLY', rvein, 0.45), red, srgb((0.25, 0.01, 0.05)))
    edge = t.smooth(t.point, 0.53, 0.62)
    red = t.mix(t.math('MULTIPLY', edge, 0.7), red, srgb((0.2, 0.02, 0.08)))
    spk = t.smooth(t.voronoi(scale=9.0, feature='F1'), 0.13, 0.07)
    spk = t.math('MULTIPLY', spk, t.smooth(t.noise(scale=2.0, detail=2, w=4.0), 0.45, 0.6))
    red = t.mix(t.math('MULTIPLY', spk, 0.7), red, srgb((0.85, 0.72, 0.6)))
    pale = t.ramp(t.noise(scale=12, detail=3), [(0.3, srgb((0.82, 0.74, 0.6))), (0.7, srgb((0.95, 0.9, 0.78)))])
    base = t.mix(petal, base, red)
    rough = t.fmix(petal, rough, t.fmix(wart, 0.48, 0.72))
    # -------- pollen sacs: taut gold, dark veins, self-lit
    sv = t.smooth(t.voronoi(scale=4.0, feature='DISTANCE_TO_EDGE'), 0.06, 0.0)
    gold = t.ramp(t.noise(scale=3, detail=3), [(0.3, srgb((0.86, 0.46, 0.05))), (0.7, srgb((1.0, 0.8, 0.2)))])
    gold = t.mix(t.math('MULTIPLY', sv, 0.8), gold, srgb((0.35, 0.12, 0.03)))
    base = t.mix(sac, base, gold)
    rough = t.fmix(sac, rough, 0.3)
    # -------- lips: wet dark purple flesh
    lipc = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.14, 0.01, 0.04))), (0.7, srgb((0.32, 0.04, 0.08)))])
    base = t.mix(lip, base, lipc)
    rough = t.fmix(lip, rough, 0.2)
    # -------- the gullet: red flesh, glowing deeper in
    rel = t.vmath('SUBTRACT', t.P, tuple(float(x) for x in A.MAW))
    dp = t.vmath('DOT_PRODUCT', rel, tuple(float(-x) for x in A.FACE))
    depth = [o for o in dp.node.outputs if o.name == 'Value'][0]
    deep = t.smooth(depth, 0.1, 1.6)
    gc = t.mix(deep, srgb((0.35, 0.03, 0.03)), srgb((0.75, 0.85, 0.2)))
    base = t.mix(gullet, base, gc)
    rough = t.fmix(gullet, rough, 0.2)
    # -------- the waterline: slime and algae
    wet = t.smooth(z, 0.9, 0.15)
    base = t.mix(t.math('MULTIPLY', wet, 0.7), base, srgb((0.05, 0.1, 0.05)))
    rough = t.fmix(wet, rough, 0.25)
    color = cavity(t, base, dark=0.5, light=1.1, lo=0.46, hi=0.55)
    wm = t.math('MULTIPLY', t.smooth(wart, 0.25, 0.7), petal)
    color = t.mix(wm, color, pale)             # the pale warts, after the cavity darkening
    # -------- glow: the gullet's depth, the sacs (dimmer along their veins)
    glow_g = t.math('MULTIPLY', gullet, deep)
    gsac = t.mix(sv, srgb((0.75, 0.48, 0.05)), srgb((0.12, 0.04, 0.0)))
    t.glow = t.mix(sac, t.mix(glow_g, srgb((0, 0, 0)), srgb((0.7, 0.95, 0.15))), gsac)
    # -------- relief
    h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=30, detail=3), 0.4), t.math('MULTIPLY', net, -0.5))
    h = t.math('ADD', h, t.math('MULTIPLY', t.math('MULTIPLY', fib, root), 1.2))
    h = t.math('ADD', h, t.math('MULTIPLY', t.math('MULTIPLY', lv, leaf_m), 0.6))
    h = t.math('SUBTRACT', h, t.math('MULTIPLY', t.math('MULTIPLY', sv, sac), 0.8))
    h = t.math('ADD', h, t.math('MULTIPLY', t.math('POWER', t.math('MULTIPLY', wart, petal), 0.6), 2.2))
    t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.008))


def shade(mat, kind):
    t = NT(mat)
    k = kind
    if k == 'plant':
        plant(t)
    elif k == 'vine':
        knot, _, _, _ = attr(t, 'ZoneC')
        fib = t.noise(t.scale_vec(10, 10, 10), scale=1.0, detail=4, rough=0.6)
        base = t.ramp(fib, [(0.3, srgb((0.08, 0.1, 0.04))), (0.55, srgb((0.18, 0.22, 0.07))),
                            (0.8, srgb((0.3, 0.32, 0.11)))])
        streak = t.smooth(t.voronoi(scale=3.0, feature='DISTANCE_TO_EDGE'), 0.05, 0.0)
        base = t.mix(t.math('MULTIPLY', streak, 0.6), base, srgb((0.2, 0.03, 0.06)))
        base = t.mix(t.math('MULTIPLY', knot, 0.85), base, srgb((0.3, 0.05, 0.08)))
        wet = t.smooth(t.pz, 0.45, 0.05)
        base = t.mix(t.math('MULTIPLY', wet, 0.7), base, srgb((0.04, 0.08, 0.04)))
        color = cavity(t, base, dark=0.45, light=1.12)
        rough = t.fmix(wet, t.math('ADD', 0.5, t.math('MULTIPLY', fib, 0.2)), 0.25)
        h = t.math('ADD', fib, t.math('MULTIPLY', t.noise(scale=40, detail=2), 0.3))
        t.finish(color, rough, 0.0, t.bump(h, 0.35, 0.006))
    elif k == 'tooth':
        r, _, _, _ = attr(t, 'Col')
        tipm = r                                   # 0 at the root, 1 at the tip
        base = t.ramp(t.math('ADD', t.math('MULTIPLY', t.noise(scale=14, detail=3), 0.4), 0.3),
                      [(0.3, srgb((0.7, 0.6, 0.42))), (0.75, srgb((0.93, 0.87, 0.7)))])
        base = t.mix(t.smooth(tipm, 0.35, 0.05), base, srgb((0.35, 0.05, 0.05)))     # gum-red roots
        base = t.mix(t.smooth(tipm, 0.72, 1.0), base, srgb((0.22, 0.04, 0.03)))      # blood-dark tips
        cr = t.smooth(t.voronoi(t.scale_vec(1, 1, 3), scale=22, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', cr, 0.4), base, srgb((0.35, 0.25, 0.15)))
        t.finish(cavity(t, base, dark=0.5, light=1.08), 0.3, 0.0,
                 t.bump(t.math('ADD', cr, t.noise(scale=120)), 0.12, 0.003))
    elif k == 'bone':
        base = t.ramp(t.noise(scale=9, detail=3), [(0.3, srgb((0.55, 0.5, 0.38))), (0.7, srgb((0.8, 0.75, 0.6)))])
        stain = t.smooth(t.noise(scale=4.5, detail=4, w=1.0), 0.5, 0.7)
        base = t.mix(t.math('MULTIPLY', stain, 0.7), base, srgb((0.25, 0.22, 0.1)))
        moss = t.smooth(t.noise(scale=3.0, detail=3, w=2.5), 0.6, 0.7)
        base = t.mix(t.math('MULTIPLY', moss, 0.7), base, srgb((0.12, 0.18, 0.05)))
        cr = t.smooth(t.voronoi(t.scale_vec(1, 1, 2.5), scale=16, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', cr, 0.7), base, srgb((0.2, 0.15, 0.08)))
        wet = t.smooth(t.pz, 0.5, 0.05)
        base = t.mix(t.math('MULTIPLY', wet, 0.6), base, srgb((0.1, 0.12, 0.06)))
        color = cavity(t, base, dark=0.4, light=1.12)
        rough = t.math('ADD', 0.5, t.math('MULTIPLY', t.noise(scale=10, detail=2), 0.2))
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=60, detail=3), 0.3), t.math('MULTIPLY', cr, -1.0))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'cloth':
        fr = t.math('FRACT', t.math('MULTIPLY', t.math('ADD', t.px, t.py), 3.0))
        stripe = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', fr, 0.5)), 0.18, 0.1)
        base = t.mix(stripe, srgb((0.42, 0.3, 0.15)), srgb((0.16, 0.18, 0.24)))
        grime = t.smooth(t.noise(scale=3, detail=5, w=0.7), 0.45, 0.75)
        base = t.mix(t.math('MULTIPLY', grime, 0.75), base, srgb((0.12, 0.1, 0.06)))
        blood = t.smooth(t.noise(scale=2.0, detail=3, w=5.0), 0.62, 0.7)
        base = t.mix(t.math('MULTIPLY', blood, 0.7), base, srgb((0.22, 0.03, 0.02)))
        wet = t.smooth(t.pz, 0.7, 0.1)
        base = t.mix(t.math('MULTIPLY', wet, 0.6), base, srgb((0.05, 0.07, 0.04)))
        weave = t.noise(t.scale_vec(80, 80, 80), scale=1.0, detail=2)
        color = cavity(t, base, dark=0.5, light=1.1)
        t.finish(color, t.fmix(wet, 0.9, 0.5), 0.0, t.bump(weave, 0.2, 0.002))
    elif k == 'iron':
        rust = t.smooth(t.noise(scale=6, detail=5), 0.4, 0.6)
        base = t.mix(rust, srgb((0.2, 0.2, 0.21)), srgb((0.33, 0.14, 0.06)))
        t.finish(cavity(t, base, dark=0.4, light=1.2), t.fmix(rust, 0.45, 0.85), t.fmix(rust, 0.85, 0.1),
                 t.bump(t.noise(scale=30, detail=4), 0.3, 0.003))
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
        img = bpy.data.images.new(f'Bloom_{name}', size, size, alpha=False, float_buffer=(name == 'normal'))
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
            img.filepath_raw = os.path.join(out_dir, f'bloom_{name}_raw.png')
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
    saved = []
    for h in highs:
        for slot in h.material_slots:
            m = slot.material
            if m is None or 'GLOW_EMIT' not in m.node_tree.nodes:
                continue
            nt = m.node_tree
            out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
            prev = out.inputs['Surface'].links[0].from_socket
            nt.links.new(nt.nodes['GLOW_EMIT'].outputs[0], out.inputs['Surface'])
            saved.append((nt, prev, out))
    run('glow', 'EMIT')
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
