"""Korzul's surfaces: procedural bake shaders per kind (adapted from the Balgath,
Great Saurian and Great Jaguar kits), the shared UV atlas, and the high-to-low
Cycles bake into one albedo, one tangent normal map, one roughness/metallic map
and one EMISSIVE map (the shard-light, the eyes, the Smith's runes, the throat).

Kinds: skin (slate scales, pale belly plates, rime, frost-cracks, old wounds,
the shard-light veins), membrane, horn, tooth, claw, eye, mouth, iron,
rune_iron (the shackles: the Smith's blue runes), ice, shard.
"""
import math
import os

import bpy
import numpy as np

KINDS = ('skin', 'membrane', 'horn', 'tooth', 'claw', 'eye', 'mouth', 'iron', 'rune_iron', 'ice', 'shard')


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

    def finish(self, color, rough, metal, normal=None, mat=None, glow=None):
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
        # and the glow (the emissive map)
        ge = self.node('ShaderNodeEmission')
        ge.name = 'GLOW_EMIT'
        self._in(ge, 'Color', glow if glow is not None else (0.0, 0.0, 0.0, 1.0))
        ge.inputs['Strength'].default_value = 1.0


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


SLATE = (0.46, 0.53, 0.6)
SLATE_HI = (0.66, 0.72, 0.77)
BELLY = (0.78, 0.8, 0.8)
RIME = (0.8, 0.88, 0.94)
ROSE_GOLD = (1.0, 0.68, 0.42)
TEAL = (0.3, 0.72, 0.88)
VIOLET = (0.55, 0.42, 0.85)
SCAR = (0.56, 0.5, 0.52)


def pdist(t, P, c):
    d = t.vmath('DISTANCE', P, tuple(float(x) for x in c))
    return [o for o in d.node.outputs if o.name == 'Value'][0]


def scales(t):
    """Korzul's hide: slate scales going blue-black on the back, pale corpse-grey
    belly and throat plates, rime white in every crease and dusted on what faces the
    sky, the old wounds pale, and the shard-light: rose-gold cracks glowing out from
    the sternum across the chest and up the throat, cooling to teal at their ends."""
    import anatomy as A
    P = t.P
    ax = t.math('ABSOLUTE', t.px)
    under = t.smooth(t.nz, -0.05, -0.6)
    dorsal = t.smooth(t.nz, 0.35, 0.9)
    head = t.smooth(t.py, float(A.H((0, -17.0, 0))[1]), float(A.H((0, -17.8, 0))[1]))
    legs = t.smooth(t.pz, 6.0, 4.5)
    # -------- the scales: cells, a shingle edge toward the tail, a tint per cell
    warp = t.node('ShaderNodeTexNoise')
    warp.inputs['Scale'].default_value = 0.8
    t.link(P, warp.inputs['Vector'])
    Pw = t.vmath('ADD', P, t.vmath('MULTIPLY', warp.outputs['Color'], (0.25, 0.25, 0.25)))
    big = t.voronoi(t.scale_vec(1.0, 0.8, 1.0, Pw), scale=2.6, feature='DISTANCE_TO_EDGE')
    fine = t.voronoi(t.scale_vec(1.0, 0.85, 1.0, Pw), scale=6.5, feature='DISTANCE_TO_EDGE')
    small_zone = t.math('MAXIMUM', t.math('MAXIMUM', head, legs), under)
    cell_edge = t.fmix(small_zone, big, fine)
    vcol = t.node('ShaderNodeTexVoronoi')
    vcol.inputs['Scale'].default_value = 2.6
    t.link(t.scale_vec(1.0, 0.8, 1.0, Pw), vcol.inputs['Vector'])
    tint = [o for o in vcol.outputs if o.name == 'Color'][0]
    sep = t.node('ShaderNodeSeparateColor')
    t.link(tint, sep.inputs[0])
    rnd = sep.outputs[0]
    groove = t.smooth(cell_edge, 0.0, 0.07)
    # -------- ground colour
    mott = t.noise(scale=0.35, detail=3)
    base = t.mix(mott, srgb(SLATE), srgb(SLATE_HI))
    base = t.mix(t.math('MULTIPLY', rnd, 0.35), base, srgb((0.5, 0.58, 0.66)))
    base = t.mix(t.math('MULTIPLY', dorsal, 0.55), base, srgb((0.3, 0.37, 0.45)))
    belly = t.math('MULTIPLY', under, t.math('SUBTRACT', 1.0, t.math('MULTIPLY', legs, 0.7)))
    plates = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.py, 1.09)), 0.5)), 0.47, 0.41)
    base = t.mix(t.smooth(belly, 0.2, 0.7), base, t.mix(t.math('MULTIPLY', plates, 0.6), srgb(BELLY),
                                                         srgb((0.33, 0.31, 0.29))))
    base = t.mix(t.math('SUBTRACT', 1.0, groove), base, t.mix(1.0, base, srgb((0.45, 0.45, 0.5)), 'MULTIPLY'))
    # -------- rime: in every crease, dusted on the upward faces, in drifts
    drift = t.smooth(t.noise(scale=1.3, detail=4, w=2.0), 0.6, 0.7)
    crease = t.smooth(t.point, 0.49, 0.43)
    rime = t.math('MAXIMUM', t.math('MULTIPLY', crease, 0.85),
                  t.math('MULTIPLY', t.math('MULTIPLY', dorsal, drift), 0.65))
    rime = t.math('MAXIMUM', rime, t.math('MULTIPLY', t.math('SUBTRACT', 1.0, groove), t.math('MULTIPLY', drift, 0.25)))
    speck = t.smooth(t.noise(scale=22, detail=2), 0.6, 0.7)
    rime = t.math('MINIMUM', 1.0, t.math('ADD', rime, t.math('MULTIPLY', speck, t.math('MULTIPLY', dorsal, 0.4))))
    # -------- frost-cracks: old pale fractures across the hide
    fc = t.voronoi(t.scale_vec(1.0, 0.6, 1.0, Pw), scale=0.55, feature='DISTANCE_TO_EDGE')
    fcrack = t.math('MULTIPLY', t.smooth(fc, 0.025, 0.008), t.smooth(t.noise(scale=0.6, detail=2, w=4.0), 0.5, 0.58))
    # -------- old wounds
    sc = None
    for line in A.SCAR_LINES:
        dd = polyline_dist(t, P, line)
        sc = dd if sc is None else t.math('MINIMUM', sc, dd)
    scar = t.smooth(sc, 0.26, 0.08) if sc is not None else 0.0
    color = t.mix(t.math('MULTIPLY', scar, 0.85), base, srgb(SCAR))
    color = t.mix(t.math('MULTIPLY', fcrack, 0.7), color, srgb((0.62, 0.72, 0.8)))
    color = t.mix(t.math('MULTIPLY', rime, 0.92), color, srgb(RIME))
    color = cavity(t, color, dark=0.5, light=1.08, lo=0.47, hi=0.54)
    # -------- the mouth line and the inner lip: dark
    mz = A.MOUTH['z']
    lips = t.math('MULTIPLY', band(t, t.pz, mz, 0.09 * A.HK, 0.03),
                  t.math('MULTIPLY', t.smooth(t.py, A.MOUTH['y_corner'] + 0.3, A.MOUTH['y_corner'] - 0.1),
                         t.smooth(ax, A.MOUTH['x_max'] + 0.1, A.MOUTH['x_max'] - 0.2)))
    color = t.mix(lips, color, srgb((0.05, 0.08, 0.13)))
    # -------- the shard-light
    ds = pdist(t, P, A.SHARD_C)
    veins = t.smooth(t.voronoi(t.scale_vec(1.0, 1.0, 1.0, Pw), scale=1.5, feature='DISTANCE_TO_EDGE'), 0.03, 0.007)
    fine_v = t.smooth(t.voronoi(t.scale_vec(1.0, 1.0, 1.0, Pw), scale=4.2, feature='DISTANCE_TO_EDGE'), 0.04, 0.01)
    near = t.smooth(ds, 4.4, 1.0)
    throat = t.math('MULTIPLY', t.math('MULTIPLY', t.smooth(ax, 0.9, 0.3), under),
                    t.math('MULTIPLY', t.smooth(t.py, -6.0, -8.0), t.smooth(t.py, -19.0, -15.0)))
    glow_m = t.math('MAXIMUM', t.math('MULTIPLY', veins, near), t.math('MULTIPLY', veins,
                                                                       t.math('MULTIPLY', throat, 0.45)))
    del fine_v
    core = t.smooth(ds, 2.2, 0.6)
    glow_m = t.math('MULTIPLY', glow_m, 0.0)   # the whelp carries no shard
    hue = t.smooth(ds, 1.8, 7.0)
    gcol = t.mix(hue, srgb(ROSE_GOLD), srgb(TEAL))
    color = t.mix(t.math('MULTIPLY', glow_m, 0.6), color, t.mix(hue, srgb((1.0, 0.78, 0.55)), srgb((0.55, 0.85, 0.95))))
    rough = t.math('ADD', 0.5, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.15))
    rough = t.fmix(t.math('MULTIPLY', rime, 0.9), rough, 0.86)
    rough = t.fmix(t.math('SUBTRACT', 1.0, groove), rough, t.math('SUBTRACT', rough, 0.12))
    # -------- relief
    h = t.math('ADD', t.math('MULTIPLY', groove, 0.9), t.math('MULTIPLY', t.noise(scale=30, detail=2), 0.12))
    h = t.math('SUBTRACT', h, t.math('MULTIPLY', fcrack, 0.5))
    h = t.math('ADD', h, t.math('MULTIPLY', t.math('MULTIPLY', rime, drift), 0.25))
    glow = t.mix(glow_m, (0, 0, 0, 1), gcol)
    t.finish(color, rough, 0.0, t.bump(h, 0.42, 0.02), glow=glow)


def shade(mat, kind):
    t = NT(mat)
    k = kind
    if k == 'skin':
        scales(t)
    elif k == 'membrane':
        base = t.ramp(t.noise(scale=1.2, detail=4), [(0.3, srgb((0.12, 0.1, 0.12))), (0.75, srgb((0.24, 0.19, 0.22)))])
        veins = t.smooth(t.voronoi(t.scale_vec(1.0, 1.0, 1.0), scale=0.9, feature='DISTANCE_TO_EDGE'), 0.035, 0.008)
        base = t.mix(t.math('MULTIPLY', veins, 0.55), base, srgb((0.34, 0.27, 0.3)))
        frost = t.smooth(t.noise(scale=0.7, detail=5, w=6.0), 0.52, 0.66)
        speck = t.smooth(t.noise(scale=14, detail=2), 0.55, 0.7)
        frost = t.math('MAXIMUM', frost, t.math('MULTIPLY', speck, 0.5))
        color = t.mix(t.math('MULTIPLY', frost, 0.8), base, srgb((0.7, 0.78, 0.86)))
        wrinkles = t.noise(t.scale_vec(4, 4, 4), scale=2.0, detail=4)
        rough = t.fmix(frost, 0.62, 0.85)
        t.finish(color, rough, 0.0, t.bump(t.math('ADD', wrinkles, t.math('MULTIPLY', veins, 0.6)), 0.3, 0.02))
    elif k == 'horn':
        n = t.noise(scale=3.0, detail=4)
        base = t.ramp(n, [(0.3, srgb((0.72, 0.68, 0.58))), (0.7, srgb((0.9, 0.87, 0.78)))])
        stain = t.smooth(t.noise(scale=1.4, detail=3, w=1.0), 0.5, 0.7)
        base = t.mix(t.math('MULTIPLY', stain, 0.7), base, srgb((0.34, 0.31, 0.28)))
        grain = t.noise(t.scale_vec(28, 28, 3), scale=1.0, detail=3)
        base = t.mix(t.math('MULTIPLY', t.smooth(grain, 0.6, 0.72), 0.35), base, srgb((0.5, 0.46, 0.4)))
        cr = t.smooth(t.voronoi(t.scale_vec(1, 1, 3), scale=7, feature='DISTANCE_TO_EDGE'), 0.025, 0.0)
        base = t.mix(t.math('MULTIPLY', cr, 0.6), base, srgb((0.22, 0.2, 0.19)))
        frost = t.math('MULTIPLY', t.smooth(t.nz, 0.3, 0.8), t.smooth(t.noise(scale=4, detail=3, w=2.0), 0.45, 0.6))
        base = t.mix(t.math('MULTIPLY', frost, 0.8), base, srgb(RIME))
        color = cavity(t, base, dark=0.42, light=1.1)
        rough = t.fmix(frost, 0.42, 0.8)
        h = t.math('ADD', t.math('MULTIPLY', grain, 0.5), t.math('MULTIPLY', cr, -1.0))
        t.finish(color, rough, 0.0, t.bump(h, 0.35, 0.01))
    elif k == 'tooth':
        base = t.ramp(t.math('ADD', t.math('MULTIPLY', t.noise(scale=14, detail=3), 0.5),
                             t.math('MULTIPLY', t.smooth(t.point, 0.5, 0.58), 0.5)),
                      [(0.3, srgb((0.62, 0.58, 0.46))), (0.75, srgb((0.93, 0.9, 0.8)))])
        cr = t.smooth(t.voronoi(t.scale_vec(1, 1, 3), scale=18, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', cr, 0.5), base, srgb((0.35, 0.3, 0.22)))
        t.finish(cavity(t, base, dark=0.5, light=1.08), 0.3, 0.0, t.bump(t.math('ADD', cr, t.noise(scale=80)), 0.12, 0.004))
    elif k == 'claw':
        streak = t.noise(t.scale_vec(12, 12, 2), scale=1.0, detail=3)
        base = t.ramp(streak, [(0.3, srgb((0.07, 0.07, 0.08))), (0.7, srgb((0.2, 0.2, 0.22)))])
        tip = t.smooth(t.noise(scale=2.0, detail=2, w=5.0), 0.55, 0.7)
        base = t.mix(t.math('MULTIPLY', tip, 0.5), base, srgb((0.62, 0.6, 0.55)))
        t.finish(cavity(t, base, dark=0.5, light=1.25), 0.3, 0.0, t.bump(streak, 0.25, 0.006))
    elif k == 'eye':
        import anatomy as A
        cx = t.node('ShaderNodeCombineXYZ')
        t.link(t.math('ABSOLUTE', t.px), cx.inputs[0])
        t.link(t.py, cx.inputs[1])
        t.link(t.pz, cx.inputs[2])
        c = A.EYE - A.EYE_DIR * 0.12
        rel = t.vmath('SUBTRACT', cx.outputs[0], tuple(float(x) for x in c))
        nrm = t.vmath('NORMALIZE', rel)
        front = t.vmath('DOT_PRODUCT', nrm, tuple(float(x) for x in A.EYE_DIR))
        fr = [s for s in front.node.outputs if s.name == 'Value'][0]
        lat = np.cross(A.EYE_DIR, (0.0, 0.0, 1.0))
        lat = lat / np.linalg.norm(lat)
        dl = t.vmath('DOT_PRODUCT', nrm, tuple(float(x) for x in lat))
        dl = t.math('ABSOLUTE', [s for s in dl.node.outputs if s.name == 'Value'][0])
        streaks = t.noise(t.scale_vec(40, 40, 40), scale=1.0, detail=3)
        irc = t.ramp(t.math('ADD', t.math('MULTIPLY', streaks, 0.5), t.math('MULTIPLY', t.smooth(fr, 0.5, 0.95), 0.5)),
                     [(0.2, srgb((0.12, 0.42, 0.72))), (0.55, srgb((0.45, 0.82, 1.0))), (0.9, srgb((0.86, 0.97, 1.0)))])
        iris = t.smooth(fr, 0.2, 0.32)
        color = t.mix(iris, srgb((0.03, 0.02, 0.02)), irc)
        slit = t.math('MULTIPLY', t.smooth(fr, 0.55, 0.65), t.smooth(dl, 0.13, 0.07))
        color = t.mix(slit, color, srgb((0.01, 0.01, 0.01)))
        glow = t.mix(t.math('MULTIPLY', iris, t.math('SUBTRACT', 1.0, slit)), (0, 0, 0, 1), irc)
        t.finish(color, 0.05, 0.0, glow=glow)
    elif k == 'mouth':
        # A rime whelp's mouth: frost-blue gums and throat, rimed with ice light.
        base = t.ramp(t.noise(scale=6), [(0.3, srgb((0.1, 0.16, 0.26))), (0.7, srgb((0.26, 0.4, 0.55)))])
        ridges = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.py, 5.0)), 0.5)),
                          0.12, 0.05)
        base = t.mix(t.math('MULTIPLY', ridges, 0.4), base, srgb((0.06, 0.1, 0.16)))
        g = t.smooth(t.noise(scale=3, detail=3, w=3.0), 0.45, 0.7)
        glow = t.mix(t.math('MULTIPLY', g, 0.3), (0, 0, 0, 1), srgb((0.55, 0.88, 1.0)))
        t.finish(base, 0.3, 0.0, t.bump(t.math('ADD', ridges, t.noise(scale=40)), 0.2, 0.004), glow=glow)
    elif k in ('iron', 'rune_iron'):
        n = t.noise(scale=6, detail=5)
        base = t.ramp(n, [(0.3, srgb((0.12, 0.13, 0.145))), (0.7, srgb((0.24, 0.25, 0.27)))])
        pit = t.smooth(t.noise(scale=30, detail=3), 0.58, 0.68)
        base = t.mix(t.math('MULTIPLY', pit, 0.6), base, srgb((0.06, 0.06, 0.07)))
        worn = t.smooth(t.point, 0.52, 0.58)
        base = t.mix(t.math('MULTIPLY', worn, 0.7), base, srgb((0.48, 0.5, 0.53)))
        frost = t.math('MULTIPLY', t.smooth(t.nz, 0.4, 0.85), t.smooth(t.noise(scale=3, detail=3, w=7.0), 0.55, 0.66))
        base = t.mix(t.math('MULTIPLY', frost, 0.7), base, srgb(RIME))
        metal = t.fmix(frost, 0.85, 0.0)
        rough = t.fmix(frost, t.math('ADD', 0.45, t.math('MULTIPLY', pit, 0.25)), 0.82)
        glow = None
        if k == 'rune_iron':
            cells = t.voronoi(t.scale_vec(1.0, 1.0, 1.0), scale=5.0, feature='DISTANCE_TO_EDGE')
            pick = t.smooth(t.noise(scale=2.5, detail=1, w=9.0), 0.58, 0.63)
            runes = t.math('MULTIPLY', t.smooth(cells, 0.022, 0.009), pick)
            runes = t.math('MULTIPLY', runes, t.math('SUBTRACT', 1.0, frost))
            base = t.mix(runes, base, srgb((0.55, 0.85, 1.0)))
            metal = t.fmix(runes, metal, 0.0)
            glow = t.mix(t.math('MULTIPLY', runes, 0.9), (0, 0, 0, 1), srgb((0.35, 0.72, 1.0)))
        t.finish(cavity(t, base, dark=0.45, light=1.2), rough, metal,
                 t.bump(t.math('ADD', t.math('MULTIPLY', pit, -0.6), t.math('MULTIPLY', n, 0.3)), 0.3, 0.01), glow=glow)
    elif k == 'ice':
        cr = t.voronoi(t.scale_vec(1, 1, 1), scale=3.0, feature='DISTANCE_TO_EDGE')
        crack = t.smooth(cr, 0.03, 0.008)
        depth = t.noise(scale=1.8, detail=4)
        base = t.ramp(depth, [(0.3, srgb((0.3, 0.55, 0.72))), (0.7, srgb((0.62, 0.84, 0.95)))])
        base = t.mix(t.math('MULTIPLY', crack, 0.8), base, srgb((0.93, 0.97, 1.0)))
        frost = t.math('MULTIPLY', t.smooth(t.nz, 0.4, 0.9), t.smooth(t.noise(scale=5, detail=3, w=4.0), 0.4, 0.55))
        base = t.mix(t.math('MULTIPLY', frost, 0.7), base, srgb((0.9, 0.95, 0.98)))
        rough = t.fmix(t.math('MAXIMUM', frost, crack), 0.1, 0.6)
        glow = t.mix(t.math('MULTIPLY', t.smooth(depth, 0.6, 0.3), 0.18), (0, 0, 0, 1), srgb((0.35, 0.75, 0.95)))
        t.finish(base, rough, 0.0, t.bump(t.math('ADD', t.math('MULTIPLY', crack, -1.0), t.math('MULTIPLY', depth, 0.2)),
                                          0.3, 0.01), glow=glow)
    elif k == 'shard':
        import anatomy as A
        ds = pdist(t, t.P, A.SHARD_C)
        fac = t.noise(scale=6, detail=3)
        edge = t.smooth(t.point, 0.52, 0.6)
        core = t.mix(t.smooth(ds, 0.8, 2.6), srgb((1.0, 0.62, 0.34)), srgb((0.95, 0.45, 0.3)))
        rim = t.mix(t.smooth(fac, 0.4, 0.65), srgb(TEAL), srgb(VIOLET))
        col = t.mix(t.math('MULTIPLY', edge, 0.75), core, rim)
        inner = t.smooth(t.noise(scale=9, detail=3, w=3.0), 0.35, 0.75)
        glow = t.mix(t.math('MULTIPLY', inner, 0.5), t.mix(1.0, col, (0.5, 0.5, 0.5, 1.0), 'MULTIPLY'), col)
        t.finish(t.mix(1.0, col, (0.55, 0.55, 0.55, 1.0), 'MULTIPLY'), 0.06, 0.0, glow=glow)
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
        img = bpy.data.images.new(f'Korzul_{name}', size, size, alpha=False, float_buffer=(name == 'normal'))
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
            img.filepath_raw = os.path.join(out_dir, f'korzul_{name}_raw.png')
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
    run('emit', 'EMIT', 'sRGB')
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
