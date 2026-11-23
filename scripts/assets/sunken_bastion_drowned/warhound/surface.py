"""The Bastion Warhound's surfaces: procedural bake shaders per kind (the Great
Jaguar's kit: the node builder, the shared UV atlas and the high-to-low Cycles
bake into one albedo, one tangent normal map and one roughness/metallic map).

Kinds: skin (the drowned hide), iron (the collar, the chamfron, the back lames),
leather (the quilted war-coat), cloth (the Bastion caparison with its sigil),
tooth, claw, mouth, barnacle, kelp. The eyes and the throat glow are flat
emissive parts and skip the bake.
"""
import math
import os

import bpy
import numpy as np

KINDS = ('skin', 'iron', 'leather', 'cloth', 'tooth', 'claw', 'mouth', 'barnacle', 'kelp')


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


HIDE = (0.4, 0.44, 0.42)
HIDE_DARK = (0.24, 0.28, 0.28)
FLESH = (0.42, 0.3, 0.3)


def wet(t, color, rough, h, amount=1.0):
    """The sea still running off it: long streaks down every flank, darker and
    slicker low on the body, a dried salt crust on the upward faces."""
    streak = t.smooth(t.noise(t.scale_vec(8.0, 8.0, 0.6), scale=1.0, detail=3), 0.55, 0.7)
    low = t.smooth(t.pz, 2.0, 0.4)
    w = t.math('MULTIPLY', t.math('MAXIMUM', t.math('MULTIPLY', streak, 0.6), t.math('MULTIPLY', low, 0.55)), amount)
    color = t.mix(t.math('MULTIPLY', w, 0.4), color, t.mix(1.0, color, srgb((0.7, 0.73, 0.72)), 'MULTIPLY'))
    rough = t.fmix(w, rough, t.math('MULTIPLY', rough, 0.45))
    up = t.smooth(t.nz, 0.35, 0.85)
    salt = t.math('MULTIPLY', t.math('MULTIPLY', up, t.smooth(t.noise(scale=7, detail=4, w=5.0), 0.58, 0.68)),
                  0.5 * amount)
    salt = t.math('MULTIPLY', salt, t.fmix(t.smooth(t.noise(scale=160, detail=1), 0.45, 0.7), 0.5, 1.0))
    color = t.mix(salt, color, srgb((0.72, 0.74, 0.7)))
    rough = t.fmix(salt, rough, 0.9)
    h = t.math('ADD', h, t.math('MULTIPLY', salt, 0.5))
    return color, rough, h


def algae(t, color, rough, amount=1.0):
    hollow = t.smooth(t.point, 0.5, 0.44)
    patch = t.smooth(t.noise(scale=3.2, detail=5, rough=0.6, w=2.0), 0.45, 0.62)
    m = t.math('MULTIPLY', t.math('MAXIMUM', t.math('MULTIPLY', hollow, 0.8), t.math('MULTIPLY', patch, 0.55)), amount)
    film = t.mix(t.noise(scale=18, detail=3), srgb((0.16, 0.22, 0.15)), srgb((0.3, 0.36, 0.24)))
    return t.mix(m, color, film), t.fmix(m, rough, 0.7)


def rust_iron(t, base_a=(0.36, 0.39, 0.4), base_b=(0.5, 0.53, 0.53), rust_amt=1.0):
    base = t.ramp(t.noise(scale=2.4, detail=5, rough=0.6), [(0.3, srgb(base_a)), (0.7, srgb(base_b))])
    bloom = t.smooth(t.noise(scale=3.6, detail=6, rough=0.7), 0.56 - 0.08 * rust_amt, 0.7 - 0.06 * rust_amt)
    drip = t.math('MULTIPLY', t.smooth(t.noise(t.scale_vec(14.0, 14.0, 1.1), scale=1.0, detail=3), 0.6, 0.72), 0.8)
    crev = t.smooth(t.point, 0.48, 0.42)
    rust = t.math('MULTIPLY', t.math('MAXIMUM', t.math('MAXIMUM', bloom, drip), crev), rust_amt)
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
    h = t.math('ADD', h, t.math('MULTIPLY', t.smooth(t.noise(scale=9, detail=3), 0.55, 0.75), 0.6))
    return color, rough, metal, h


def hide(t):
    """The drowned hound's hide: a grey-green, waterlogged coat matted into short
    wet clumps, mottled darker along the back, sloughed away in pale raw patches
    (the sores and the flank hole show dark flesh and pale bone), slick with sea
    water, a crust of salt on the back. The nose leather and the lips black."""
    import anatomy as A
    P = t.P
    mott = t.noise(scale=2.2, detail=5, rough=0.6)
    base = t.ramp(mott, [(0.3, srgb(HIDE_DARK)), (0.75, srgb(HIDE))])
    back = t.smooth(t.nz, 0.2, 0.75)
    base = t.mix(t.math('MULTIPLY', back, 0.55), base, srgb((0.19, 0.22, 0.22)))
    belly = t.smooth(t.nz, -0.3, -0.75)
    base = t.mix(t.math('MULTIPLY', belly, 0.5), base, srgb((0.52, 0.54, 0.5)))
    # sloughed hide: pale grey-pink raw patches, and the dark sores in the pits
    slough = t.smooth(t.noise(scale=2.2, detail=4, w=8.0), 0.62, 0.7)
    base = t.mix(t.math('MULTIPLY', slough, 0.7), base, srgb((0.46, 0.48, 0.44)))
    sore = t.smooth(t.point, 0.45, 0.39)
    base = t.mix(t.math('MULTIPLY', sore, 0.75), base, srgb((0.22, 0.14, 0.13)))
    # the flank hole: dark wet flesh with the pale ribs standing in it
    hd = t.vmath('DISTANCE', P, tuple(A.FLANK_HOLE + np.array((-0.05, 0, 0))))
    hd = [o for o in hd.node.outputs if o.name == 'Value'][0]
    hole = t.math('MULTIPLY', t.smooth(hd, 0.46, 0.36), t.smooth(t.px, 0.3, 0.45))
    rib = t.math('MULTIPLY', hole, t.smooth(t.point, 0.52, 0.57))
    base = t.mix(hole, base, srgb((0.18, 0.08, 0.08)))
    base = t.mix(rib, base, srgb((0.72, 0.68, 0.58)))
    # the nose leather and the lip line
    nose_c = A.H((0, -3.72, 3.665))
    dn = t.vmath('DISTANCE', P, tuple(nose_c))
    dn = [o for o in dn.node.outputs if o.name == 'Value'][0]
    nose = t.math('MULTIPLY', t.smooth(dn, 0.085 * A.HK, 0.06 * A.HK), t.smooth(t.ny, -0.1, -0.5))
    lips = t.math('MULTIPLY', band(t, t.pz, A.MOUTH['z'], 0.045, 0.02),
                  t.smooth(t.py, A.MOUTH['y_corner'] + 0.05, A.MOUTH['y_corner'] - 0.05))
    base = t.mix(t.math('MAXIMUM', nose, lips), base, srgb((0.05, 0.05, 0.055)))
    # around the eyes: dark, sunken
    eyes = []
    for s in (1, -1):
        e = np.asarray(A._m(A.EYE, s))
        dd = t.vmath('DISTANCE', P, tuple(e))
        eyes.append([o for o in dd.node.outputs if o.name == 'Value'][0])
    de = t.math('MINIMUM', eyes[0], eyes[1])
    base = t.mix(t.smooth(de, A.EYE_R + 0.09, A.EYE_R + 0.03), base, srgb((0.07, 0.08, 0.08)))
    # the scars: pale and hairless
    sc = None
    for line in A.SCAR_LINES:
        dd = polyline_dist(t, P, line)
        sc = dd if sc is None else t.math('MINIMUM', sc, dd)
    scar = t.smooth(sc, 0.03, 0.012) if sc is not None else 0.0
    base = t.mix(t.math('MULTIPLY', scar, 0.85), base, srgb((0.6, 0.55, 0.52)))
    color = cavity(t, base, dark=0.55, light=1.08, lo=0.46, hi=0.55)
    # matted wet clumps: strands combed back on the body, down the legs
    strands = t.noise(t.scale_vec(40, 8, 40), scale=1.0, detail=3, rough=0.6)
    clumps = t.noise(t.scale_vec(8, 3, 8), scale=1.0, detail=2)
    h = t.math('ADD', t.math('MULTIPLY', strands, 0.5), t.math('MULTIPLY', clumps, 0.6))
    h = t.math('SUBTRACT', h, t.math('MULTIPLY', t.math('MAXIMUM', slough, hole), 0.6))
    rough = t.math('ADD', 0.55, t.math('MULTIPLY', t.noise(scale=6, detail=2), 0.15))
    rough = t.fmix(t.math('MAXIMUM', t.math('MAXIMUM', nose, hole), sore), rough, 0.3)
    color, rough = algae(t, color, rough, amount=0.35)
    color, rough, h = wet(t, color, rough, h, amount=0.8)
    t.finish(color, rough, 0.0, t.bump(h, 0.32, 0.008))


def shade(mat, kind):
    t = NT(mat)
    k = kind
    if k == 'skin':
        hide(t)
    elif k == 'iron':
        color, rough, metal, h = rust_iron(t)
        color, rough = algae(t, color, rough, amount=0.5)
        color, rough, h = wet(t, color, rough, h)
        t.finish(color, rough, metal, t.bump(h, 0.35, 0.006))
    elif k == 'leather':
        base = t.ramp(t.noise(scale=4, detail=5), [(0.35, srgb((0.12, 0.11, 0.1))), (0.65, srgb((0.2, 0.18, 0.15)))])
        scuff = t.smooth(t.noise(t.scale_vec(5, 5, 26), scale=1.0, detail=3), 0.6, 0.68)
        base = t.mix(t.math('MULTIPLY', scuff, 0.6), base, srgb((0.34, 0.28, 0.22)))
        crack = t.smooth(t.voronoi(scale=26, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        base = t.mix(t.math('MULTIPLY', crack, 0.5), base, srgb((0.05, 0.04, 0.03)))
        # quilted rows of rivets (the padded war-coat)
        rows = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.py, 4.0)), 0.5)),
                        0.04, 0.0)
        base = t.mix(t.math('MULTIPLY', rows, 0.6), base, srgb((0.08, 0.06, 0.05)))
        color = cavity(t, base, dark=0.5, light=1.15)
        rough = t.math('ADD', 0.45, t.math('MULTIPLY', t.noise(scale=4, detail=2), 0.2))
        h = t.math('SUBTRACT', t.math('MULTIPLY', scuff, 0.4), t.math('MULTIPLY', t.math('MAXIMUM', crack, rows), 0.8))
        color, rough = algae(t, color, rough, amount=0.45)
        color, rough, h = wet(t, color, rough, h)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'cloth':
        # the Bastion's colours: a faded sea-green caparison, the tower over three
        # waves in pale thread on each flank, torn, rotten and weed-stained
        weave = t.noise(t.scale_vec(160, 160, 160), scale=1.0, detail=2)
        base = t.ramp(t.noise(scale=2.5, detail=4), [(0.3, srgb((0.17, 0.24, 0.22))), (0.7, srgb((0.24, 0.32, 0.29)))])
        fade = t.smooth(t.noise(scale=1.2, detail=3), 0.5, 0.72)
        base = t.mix(t.math('MULTIPLY', fade, 0.55), base, srgb((0.3, 0.34, 0.31)))
        # the sigil, centred on each flank at (|x|, y=0.35, z=2.25), drawn on the y-z plane
        u = t.math('SUBTRACT', t.py, 0.35)
        v = t.math('SUBTRACT', t.pz, 2.25)
        au = t.math('ABSOLUTE', u)

        def box(x0, x1, z0, z1):
            return t.math('MULTIPLY', t.math('MULTIPLY', t.smooth(au, x1 + 0.01, x1), t.smooth(au, x0 - 0.01, x0)),
                          t.math('MULTIPLY', t.smooth(v, z0, z0 + 0.01), t.smooth(v, z1, z1 - 0.01)))
        shaft = box(-0.01, 0.06, -0.02, 0.22)
        crown = box(-0.01, 0.085, 0.22, 0.27)
        merl = t.math('MULTIPLY', box(-0.01, 0.085, 0.27, 0.31),
                      t.smooth(t.math('ABSOLUTE', t.math('SINE', t.math('MULTIPLY', u, 55.0))), 0.25, 0.35))
        gate = box(-0.01, 0.025, -0.02, 0.06)
        tower = t.math('SUBTRACT', t.math('MAXIMUM', t.math('MAXIMUM', shaft, crown), merl), gate, clamp=True)
        waves = None
        for zc in (-0.06, -0.11, -0.16):
            wz = t.math('ADD', zc, t.math('MULTIPLY', t.math('SINE', t.math('MULTIPLY', u, 34.0)), 0.01))
            b = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', v, wz)), 0.01, 0.004)
            b = t.math('MULTIPLY', b, t.smooth(au, 0.14, 0.12))
            waves = b if waves is None else t.math('MAXIMUM', waves, b)
        rr = t.math('SQRT', t.math('ADD', t.math('MULTIPLY', u, u),
                                   t.math('MULTIPLY', t.math('SUBTRACT', v, 0.06), t.math('SUBTRACT', v, 0.06))))
        ring = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', rr, 0.3)), 0.014, 0.005)
        emb = t.math('MAXIMUM', t.math('MAXIMUM', tower, waves), ring)
        side = t.smooth(t.math('ABSOLUTE', t.nx), 0.4, 0.7)
        frayed = t.smooth(t.noise(scale=40, detail=2), 0.3, 0.5)
        emb = t.math('MULTIPLY', t.math('MULTIPLY', emb, side), frayed)
        base = t.mix(t.math('MULTIPLY', emb, 0.8), base, srgb((0.6, 0.62, 0.55)))
        stain = t.smooth(t.math('ADD', t.pz, t.math('MULTIPLY', t.noise(scale=3, detail=3), 0.25)), 2.0, 1.65)
        base = t.mix(t.math('MULTIPLY', stain, 0.7), base, srgb((0.12, 0.15, 0.1)))
        color = cavity(t, base, dark=0.55, light=1.1)
        color = t.mix(t.math('MULTIPLY', weave, 0.12), color, srgb((0.34, 0.37, 0.34)))
        h = t.math('ADD', t.math('MULTIPLY', weave, 0.4), t.math('MULTIPLY', t.noise(scale=6, detail=3), 0.6))
        color, rough, h = wet(t, color, 0.75, h, amount=0.9)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004))
    elif k == 'tooth':
        base = t.ramp(t.noise(scale=40, detail=2), [(0.3, srgb((0.5, 0.45, 0.32))), (0.7, srgb((0.68, 0.62, 0.47)))])
        root = t.smooth(t.point, 0.47, 0.42)
        t.finish(t.mix(root, base, srgb((0.2, 0.15, 0.1))), 0.35, 0.0)
    elif k == 'claw':
        streak = t.noise(t.scale_vec(30, 30, 3), scale=1.0, detail=3)
        base = t.ramp(streak, [(0.3, srgb((0.1, 0.09, 0.08))), (0.7, srgb((0.22, 0.2, 0.17)))])
        t.finish(cavity(t, base, dark=0.5, light=1.2), 0.3, 0.0, t.bump(streak, 0.25, 0.004))
    elif k == 'mouth':
        base = t.ramp(t.noise(scale=18), [(0.3, srgb((0.12, 0.08, 0.1))), (0.7, srgb((0.28, 0.17, 0.2)))])
        ridges = t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('FRACT', t.math('MULTIPLY', t.py, 22.0)), 0.5)),
                          0.12, 0.05)
        base = t.mix(t.math('MULTIPLY', ridges, 0.4), base, srgb((0.06, 0.04, 0.05)))
        t.finish(base, 0.25, 0.0, t.bump(t.math('ADD', ridges, t.noise(scale=90)), 0.2, 0.003))
    elif k == 'barnacle':
        base = t.ramp(t.noise(scale=30, detail=3), [(0.3, srgb((0.42, 0.41, 0.37))), (0.7, srgb((0.56, 0.55, 0.5)))])
        crater = t.smooth(t.point, 0.47, 0.4)
        base = t.mix(crater, base, srgb((0.07, 0.08, 0.07)))
        ridge = t.smooth(t.point, 0.54, 0.6)
        base = t.mix(t.math('MULTIPLY', ridge, 0.5), base, srgb((0.66, 0.65, 0.6)))
        color, rough = algae(t, cavity(t, base, dark=0.5, light=1.1), 0.8, amount=0.65)
        t.finish(color, rough, 0.0, t.bump(t.noise(scale=80, detail=2), 0.3, 0.003))
    elif k == 'kelp':
        base = t.ramp(t.noise(t.scale_vec(6, 6, 1.5), scale=1.0, detail=3), [(0.3, srgb((0.12, 0.13, 0.06))),
                                                                          (0.7, srgb((0.24, 0.24, 0.1)))])
        vein = t.smooth(t.noise(t.scale_vec(40, 40, 3), scale=1.0, detail=2), 0.55, 0.62)
        base = t.mix(t.math('MULTIPLY', vein, 0.4), base, srgb((0.3, 0.3, 0.14)))
        t.finish(cavity(t, base, dark=0.5, light=1.1), 0.3, 0.0, t.bump(t.noise(scale=60, detail=2), 0.2, 0.003))
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
        img = bpy.data.images.new(f'Warhound_{name}', size, size, alpha=False, float_buffer=(name == 'normal'))
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
            img.filepath_raw = os.path.join(out_dir, f'warhound_{name}_raw.png')
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
