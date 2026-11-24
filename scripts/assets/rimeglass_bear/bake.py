"""Rimeglass Bear texture bake (headless Blender).

blender --background --python scripts/assets/rimeglass_bear/bake.py -- \
    <in.glb> <out.glb> <out_basecolor.png> <strength>

Keeps the Tripo palette and bakes one 1024px base colour with:
- fur strands (stretched, noise-warped wave bands) and white frost flecks on the fur,
- a top-lit sheen and bright facet edges on the ice shards (found by colour),
- ambient occlusion and edge highlights over everything.
"""
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1 :]
SRC, OUT_GLB, OUT_PNG = argv[0], argv[1], argv[2]
K = float(argv[3]) if len(argv) > 3 else 1.0  # detail strength, 1.0 = "in between"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
mat = obj.active_material
nt = mat.node_tree
N, L = nt.nodes, nt.links
bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED')
base_tex = bsdf.inputs['Base Color'].links[0].from_node
out = next(n for n in N if n.type == 'OUTPUT_MATERIAL')


def node(t, **kw):
    n = N.new(t)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def math(op, a, b=None, clamp=False):
    m = node('ShaderNodeMath', operation=op, use_clamp=clamp)
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            m.inputs[i].default_value = v
        else:
            L.new(v, m.inputs[i])
    return m.outputs[0]


def mix(fac, a, b, blend='MIX'):
    m = node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
    if isinstance(fac, (int, float)):
        m.inputs[0].default_value = fac
    else:
        L.new(fac, m.inputs[0])
    for sock, v in ((6, a), (7, b)):
        if isinstance(v, tuple):
            m.inputs[sock].default_value = v
        else:
            L.new(v, m.inputs[sock])
    return m.outputs[2]


def smooth(v, lo, hi):
    r = node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
    L.new(v, r.inputs[0])
    r.inputs[1].default_value, r.inputs[2].default_value = lo, hi
    return r.outputs[0]


col = base_tex.outputs['Color']
hsv = node('ShaderNodeSeparateColor', mode='HSV')
L.new(col, hsv.inputs[0])
# Ice: saturated blue. Fur: the pale, low-saturation rest.
hue_blue = math('MULTIPLY', smooth(hsv.outputs[0], 0.48, 0.52), math('SUBTRACT', 1.0, smooth(hsv.outputs[0], 0.68, 0.72)))
ice = math('MULTIPLY', smooth(hsv.outputs[1], 0.6, 0.72), hue_blue, clamp=True)
fur = math('SUBTRACT', 1.0, ice)

coord = node('ShaderNodeTexCoord').outputs['Object']
# Fur strands: wave bands stretched along the body's vertical, warped by noise.
mp = node('ShaderNodeMapping')
mp.inputs['Scale'].default_value = (3.0, 3.0, 0.6)
L.new(coord, mp.inputs[0])
wave = node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='X')
wave.inputs['Scale'].default_value = 38.0
wave.inputs['Distortion'].default_value = 9.0
wave.inputs['Detail'].default_value = 3.0
L.new(mp.outputs[0], wave.inputs['Vector'])
strand = math('SUBTRACT', wave.outputs['Fac'], 0.5)  # -0.5..0.5
fur_lum = math('ADD', 1.0, math('MULTIPLY', strand, 0.5 * K))
fleck_n = node('ShaderNodeTexNoise')
fleck_n.inputs['Scale'].default_value = 140.0
fleck_n.inputs['Detail'].default_value = 1.0
L.new(coord, fleck_n.inputs['Vector'])
fleck = math('MULTIPLY', smooth(fleck_n.outputs['Fac'], 0.66, 0.74), 0.55 * K)

geo = node('ShaderNodeNewGeometry')
sep_n = node('ShaderNodeSeparateXYZ')
L.new(geo.outputs['Normal'], sep_n.inputs[0])
top = smooth(sep_n.outputs['Z'], -0.2, 0.9)  # 0 underside .. 1 top

# Ice: brighter toward the top, with a bright rim on facet edges.
bev = node('ShaderNodeBevel', samples=8)
bev.inputs['Radius'].default_value = 0.012
dotn = node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
L.new(bev.outputs[0], dotn.inputs[0])
L.new(geo.outputs['Normal'], dotn.inputs[1])
edge = smooth(math('SUBTRACT', 1.0, dotn.outputs['Value']), 0.01, 0.12)

ao = node('ShaderNodeAmbientOcclusion', samples=32)
ao.inputs['Distance'].default_value = 0.35
ao_f = math('ADD', 1.0 - 0.45 * K, math('MULTIPLY', ao.outputs['AO'], 0.45 * K))

# Compose.
scale = node('ShaderNodeVectorMath', operation='SCALE')  # base colour times strand luminance
L.new(col, scale.inputs[0])
L.new(fur_lum, scale.inputs['Scale'])
frost = mix(0.4 * K, scale.outputs[0], (0.86, 0.91, 0.96, 1.0))
fur_col = mix(fleck, frost, (0.97, 0.99, 1.0, 1.0))
fur_col = mix(math('MULTIPLY', math('SUBTRACT', 1.0, top), 0.25 * K), fur_col, (0.42, 0.55, 0.72, 1.0), 'MULTIPLY')
ice_col = mix(math('MULTIPLY', top, 0.35 * K), col, (0.8, 0.95, 1.0, 1.0), 'SCREEN')
body = mix(ice, fur_col, ice_col)
body = mix(math('MULTIPLY', edge, 0.5 * K), body, (0.92, 0.97, 1.0, 1.0), 'SCREEN')
final = mix(ao_f, (0, 0, 0, 1), body)

emit = node('ShaderNodeEmission')
L.new(final, emit.inputs['Color'])
orig_surface = out.inputs['Surface'].links[0].from_socket
L.new(emit.outputs[0], out.inputs['Surface'])

def bake_to(name, path, colorspace):
    im = bpy.data.images.new(name, 1024, 1024)
    im.colorspace_settings.name = colorspace
    bn = node('ShaderNodeTexImage', image=im)
    for n in N:
        n.select = False
    bn.select = True
    N.active = bn
    bpy.ops.object.bake(type='EMIT')
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    return im


img = bpy.data.images.new('rimeglass_bear_basecolor', 1024, 1024)
bake_node = node('ShaderNodeTexImage', image=img)
for n in N:
    n.select = False
bake_node.select = True
N.active = bake_node

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 48
sc.render.bake.margin = 8
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.bake(type='EMIT')
img.filepath_raw = OUT_PNG
img.file_format = 'PNG'
img.save()

# Roughness: matte fur (0.85), glossy ice (0.3), packed in G as glTF expects.
rough = math('ADD', 0.85, math('MULTIPLY', ice, -0.55))
comb = node('ShaderNodeCombineColor')
L.new(rough, comb.inputs[1])
L.new(comb.outputs[0], emit.inputs['Color'])
rimg = bake_to('rimeglass_bear_rough', OUT_PNG.replace('.png', '_rough.png'), 'Non-Color')
L.new(orig_surface, out.inputs['Surface'])
rt = node('ShaderNodeTexImage', image=rimg)
sepr = node('ShaderNodeSeparateColor')
L.new(rt.outputs['Color'], sepr.inputs[0])
L.new(sepr.outputs[1], bsdf.inputs['Roughness'])
for lk in list(bsdf.inputs['Metallic'].links):
    L.remove(lk)
bsdf.inputs['Metallic'].default_value = 0.0
rimg.pack()

# Restore the PBR material with the baked base colour.
L.new(orig_surface, out.inputs['Surface'])
base_tex.image = img
img.pack()
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_image_format='AUTO')
print('BAKED', OUT_GLB)
