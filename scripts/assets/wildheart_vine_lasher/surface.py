"""The Snarlvine Lasher's surfaces: procedural bake shaders per kind (adapted
from the Jaguar, Saurian and Balgath kits), the shared UV atlas, and the
high-to-low Cycles bake into one albedo, one tangent normal map, one
roughness/metallic map and one EMISSIVE map (the glowing sap).

Kinds: vine (the braided body: olive-green young vine over grey-brown old bark,
fibres, algae on top, red veins, the deepest crevices glowing with sap), bark
(fissured plates whose deepest cracks glow), moss, thorn, petal (blood red with
pale warts, the Gorgebloom's colours), pollen, sap (self-lit), maw (the throat).
"""
import math
import os

import bpy
import numpy as np

KINDS = ('vine', 'bark', 'moss', 'thorn', 'petal', 'pollen', 'sap', 'maw')
SAP = (0.62, 1.0, 0.16)
SPROUT = False   # build.py sets it for the Sprout (younger, greener, redder veins)


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

    def finish(self, color, rough, metal, normal=None, mat=None, emit=None):
        """`emit`: a colour socket or tuple, the glow baked into the emissive map."""
        if emit is not None and hasattr(emit, 'is_output'):
            # the glow also brightens the albedo, so it reads even unlit
            color = self.mix(0.6, color, emit, 'SCREEN')
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
        ge = self.node('ShaderNodeEmission')
        ge.name = 'GLOW_EMIT'
        self._in(ge, 'Color', emit if emit is not None else (0.0, 0.0, 0.0, 1.0))
        ge.inputs['Strength'].default_value = 1.0


# ------------------------------------------------------------------ shared masks

def cavity(t, color, dark=0.55, light=1.12, lo=0.47, hi=0.53):
    concave = t.smooth(t.point, lo, lo - 0.08)
    convex = t.smooth(t.point, hi, hi + 0.08)
    color = t.mix(concave, color, t.mix(1.0, color, srgb((dark * 0.6, dark * 0.55, dark * 0.5)), 'MULTIPLY'))
    color = t.mix(t.math('MULTIPLY', convex, 0.6), color, t.mix(1.0, color, srgb((light, light, light * 0.97)), 'MULTIPLY'))
    return color


# ------------------------------------------------------------------ kinds
def glow_mask(t, concave_lo, concave_hi, patch_scale=1.6, patch=0.45):
    """Where the sap shows: the deepest crevices, in patches (not everywhere)."""
    deep = t.smooth(t.point, concave_hi, concave_lo)
    pat = t.smooth(t.noise(scale=patch_scale, detail=2, w=4.2), patch, patch + 0.12)
    return t.math('MULTIPLY', deep, pat)


def sap_color(t, mask, gain=1.0):
    return t.mix(t.math('MULTIPLY', mask, gain), (0.0, 0.0, 0.0, 1.0), srgb(SAP))


def shade(mat, kind):
    t = NT(mat)
    k = kind
    if k == 'vine':
        fib = t.noise(t.scale_vec(9, 9, 2.2), scale=1.0, detail=5, rough=0.6)
        age = t.math('ADD', t.noise(scale=0.9, detail=3, w=1.7), t.math('MULTIPLY', t.pz, -0.05))
        young = srgb((0.15, 0.22, 0.07)) if not SPROUT else srgb((0.22, 0.36, 0.08))
        old = srgb((0.2, 0.155, 0.105)) if not SPROUT else srgb((0.19, 0.22, 0.08))
        base = t.mix(t.smooth(age, 0.28, 0.46) if not SPROUT else t.smooth(age, 0.45, 0.62), young, old)
        base = t.mix(t.math('MULTIPLY', t.smooth(fib, 0.5, 0.75), 0.6), base, srgb((0.34, 0.29, 0.21)))
        base = t.mix(t.math('MULTIPLY', t.smooth(fib, 0.42, 0.2), 0.7), base, srgb((0.06, 0.045, 0.03)))
        # algae and lichen on whatever faces the sky
        up = t.math('MULTIPLY', t.smooth(t.nz, 0.45, 0.85), t.smooth(t.noise(scale=3, detail=3, w=2.2), 0.4, 0.6))
        base = t.mix(t.math('MULTIPLY', up, 0.7), base, srgb((0.25, 0.4, 0.08)))
        # red veins (the Gorgebloom's blood in it), stronger on the Sprout
        vein = t.smooth(t.voronoi(t.scale_vec(1, 1, 0.4), scale=5, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        vein = t.math('MULTIPLY', vein, t.smooth(t.noise(scale=1.2, detail=2, w=5.1), 0.48 if not SPROUT else 0.3, 0.6))
        base = t.mix(t.math('MULTIPLY', vein, 0.75), base, srgb((0.42, 0.05, 0.04)))
        color = cavity(t, base, dark=0.18, light=1.15, lo=0.48, hi=0.53)
        g = glow_mask(t, 0.4, 0.47, patch=0.42)
        rough = t.math('ADD', 0.62, t.math('MULTIPLY', fib, 0.2))
        h = t.math('ADD', t.math('MULTIPLY', fib, 0.7), t.math('MULTIPLY', vein, -0.4))
        t.finish(color, rough, 0.0, t.bump(h, 0.55, 0.008), emit=sap_color(t, g, 1.0))
    elif k == 'bark':
        dv = t.noise(scale=2.0, detail=3, w=0.4)
        cracks = t.voronoi(t.scale_vec(4.5, 4.5, 1.3), scale=2.2, feature='DISTANCE_TO_EDGE')
        cr = t.smooth(cracks, 0.06, 0.0)
        base = t.ramp(t.noise(scale=6, detail=4), [(0.3, srgb((0.17, 0.13, 0.09))), (0.7, srgb((0.34, 0.28, 0.2)))])
        lic = t.smooth(t.noise(scale=4.2, detail=4, w=3.3), 0.6, 0.7)
        base = t.mix(t.math('MULTIPLY', lic, 0.6), base, srgb((0.45, 0.5, 0.3)))
        base = t.mix(cr, base, srgb((0.03, 0.02, 0.015)))
        deep = t.math('MULTIPLY', t.smooth(cracks, 0.025, 0.0), t.smooth(dv, 0.42, 0.52))
        color = cavity(t, base, dark=0.3, light=1.12)
        h = t.math('ADD', t.math('MULTIPLY', cr, -1.0), t.math('MULTIPLY', t.noise(t.scale_vec(14, 14, 3), scale=1.0), 0.4))
        t.finish(color, 0.82, 0.0, t.bump(h, 0.6, 0.012), emit=sap_color(t, deep, 1.0))
    elif k == 'moss':
        n = t.noise(scale=24, detail=6, rough=0.7)
        base = t.ramp(t.noise(scale=3.5, detail=4), [(0.3, srgb((0.12, 0.2, 0.04))), (0.7, srgb((0.3, 0.42, 0.08)))])
        base = t.mix(t.math('MULTIPLY', t.smooth(n, 0.55, 0.7), 0.5), base, srgb((0.5, 0.56, 0.18)))
        color = cavity(t, base, dark=0.35, light=1.1)
        t.finish(color, 0.92, 0.0, t.bump(t.math('ADD', n, t.noise(scale=90, detail=2)), 0.55, 0.01))
    elif k == 'thorn':
        tipm = t.smooth(t.point, 0.52, 0.6)
        streak = t.noise(t.scale_vec(30, 30, 30), scale=1.0, detail=3)
        base = t.ramp(streak, [(0.3, srgb((0.14, 0.06, 0.04))), (0.7, srgb((0.3, 0.12, 0.06)))])
        base = t.mix(t.math('MULTIPLY', tipm, 0.85), base, srgb((0.78, 0.68, 0.5)))
        t.finish(cavity(t, base, dark=0.4, light=1.15), 0.38, 0.0, t.bump(streak, 0.2, 0.003))
    elif k == 'petal':
        warts = t.smooth(t.voronoi(scale=34, feature='F1'), 0.2, 0.08)
        vein = t.smooth(t.voronoi(t.scale_vec(1, 1, 3), scale=14, feature='DISTANCE_TO_EDGE'), 0.04, 0.0)
        base = t.ramp(t.noise(scale=7, detail=3), [(0.3, srgb((0.48, 0.03, 0.03))), (0.7, srgb((0.72, 0.08, 0.05)))])
        base = t.mix(t.math('MULTIPLY', vein, 0.6), base, srgb((0.25, 0.01, 0.03)))
        base = t.mix(t.math('MULTIPLY', warts, 0.8), base, srgb((0.86, 0.74, 0.6)))
        t.finish(cavity(t, base, dark=0.5, light=1.1), 0.42, 0.0, t.bump(t.math('ADD', warts, vein), 0.3, 0.004))
    elif k == 'pollen':
        n = t.noise(scale=60, detail=3)
        base = t.ramp(n, [(0.35, srgb((0.75, 0.48, 0.05))), (0.7, srgb((0.98, 0.82, 0.25)))])
        t.finish(base, 0.7, 0.0, t.bump(n, 0.4, 0.003), emit=srgb((0.32, 0.22, 0.02)))
    elif k == 'sap':
        n = t.noise(scale=18, detail=4)
        core = t.ramp(n, [(0.3, srgb((0.45, 0.85, 0.1))), (0.75, srgb((0.9, 1.0, 0.45)))])
        t.finish(core, 0.15, 0.0, emit=core)
    elif k == 'maw':
        n = t.noise(scale=10, detail=4)
        base = t.ramp(n, [(0.3, srgb((0.06, 0.015, 0.01))), (0.7, srgb((0.22, 0.04, 0.03)))])
        g = t.math('MULTIPLY', t.smooth(t.point, 0.48, 0.42), 0.6)
        t.finish(base, 0.3, 0.0, t.bump(n, 0.3, 0.004), emit=sap_color(t, g, 0.7))
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
        img = bpy.data.images.new(f'Lasher_{name}', size, size, alpha=False, float_buffer=(name == 'normal'))
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
            img.filepath_raw = os.path.join(out_dir, f'lasher_{name}_raw.png')
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
    run('emit', 'EMIT')
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
