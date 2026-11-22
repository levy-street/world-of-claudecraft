"""Quartered Isle creature texture bake (headless Blender).

blender --background --python scripts/assets/quartered_isle_creatures/bake.py -- \
    <in.glb> <out_basecolor.png> <out_emissive.png> <mode> [strength]

mode: warden | brute | shardling | burrower. Keeps the Tripo palette and bakes a 1024 px
base colour with surface grain (ice frost, basalt pitting, sandstone strata, fur strands
or stone grain), ambient occlusion and edge highlights, plus an emissive (glow) map from
the creature's lit colours: the Warden's cyan core, the Brute's lava seams and amber
glass, the Shardling's amber cracks, the Burrower's ore veins.
"""
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1 :]
SRC, OUT_PNG, OUT_EM, MODE = argv[:4]
K = float(argv[4]) if len(argv) > 4 else 1.0

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
    # RGBA mix: inputs 6/7, output 2 (lookups by name hit the float sockets).
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


def band(v, lo, hi, soft=0.02):
    """1 inside [lo, hi], soft edges."""
    return math('MULTIPLY', smooth(v, lo - soft, lo + soft), math('SUBTRACT', 1.0, smooth(v, hi - soft, hi + soft)))


def scale_col(c, f):
    s = node('ShaderNodeVectorMath', operation='SCALE')
    L.new(c, s.inputs[0])
    if isinstance(f, (int, float)):
        s.inputs['Scale'].default_value = f
    else:
        L.new(f, s.inputs['Scale'])
    return s.outputs[0]


col = base_tex.outputs['Color']
hsv = node('ShaderNodeSeparateColor', mode='HSV')
L.new(col, hsv.inputs[0])
H, S, V = hsv.outputs[0], hsv.outputs[1], hsv.outputs[2]
coord = node('ShaderNodeTexCoord').outputs['Object']
geo = node('ShaderNodeNewGeometry')
sep_n = node('ShaderNodeSeparateXYZ')
L.new(geo.outputs['Normal'], sep_n.inputs[0])
top = smooth(sep_n.outputs['Z'], -0.2, 0.9)


def noise(scale, detail=4.0, rough=0.6, vec=None):
    n = node('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    L.new(vec or coord, n.inputs['Vector'])
    return n.outputs['Fac']


# Edges (bevel normal against true normal) and ambient occlusion, as in the bear's bake.
bev = node('ShaderNodeBevel', samples=8)
bev.inputs['Radius'].default_value = 0.01
dotn = node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
L.new(bev.outputs[0], dotn.inputs[0])
L.new(geo.outputs['Normal'], dotn.inputs[1])
edge = smooth(math('SUBTRACT', 1.0, dotn.outputs['Value']), 0.01, 0.12)
ao = node('ShaderNodeAmbientOcclusion', samples=32)
ao.inputs['Distance'].default_value = 0.08
ao_f = math('ADD', 1.0 - 0.5 * K, math('MULTIPLY', ao.outputs['AO'], 0.5 * K))

# Lit masks, by colour. Warm: orange to amber, saturated and bright. Cyan: the Warden's core.
warm = math('MULTIPLY', band(H, 0.0, 0.14, 0.02), smooth(S, 0.45, 0.65))
warm = math('MULTIPLY', warm, smooth(V, 0.3, 0.55), clamp=True)
cyan = math('MULTIPLY', band(H, 0.44, 0.56, 0.03), smooth(S, 0.35, 0.6))
cyan = math('MULTIPLY', cyan, smooth(V, 0.55, 0.8), clamp=True)

grain = math('SUBTRACT', noise(60.0), 0.5)  # fine grain, -0.5..0.5
mottle = math('SUBTRACT', noise(9.0, 3.0), 0.5)  # broad mottling
lum = math('ADD', 1.0, math('ADD', math('MULTIPLY', grain, 0.35 * K), math('MULTIPLY', mottle, 0.3 * K)))

if MODE == 'warden':
    fleck = math('MULTIPLY', smooth(noise(140.0, 1.0), 0.66, 0.74), 0.5 * K)
    body = scale_col(col, lum)
    body = mix(math('MULTIPLY', top, 0.3 * K), body, (0.85, 0.95, 1.0, 1.0), 'SCREEN')
    body = mix(fleck, body, (0.97, 0.99, 1.0, 1.0))
    body = mix(math('MULTIPLY', edge, 0.55 * K), body, (0.9, 0.97, 1.0, 1.0), 'SCREEN')
    glow, glow_col = cyan, (0.35, 0.95, 1.0, 1.0)
elif MODE == 'brute':
    pits = math('MULTIPLY', smooth(noise(90.0, 2.0), 0.62, 0.7), 0.45 * K)
    body = scale_col(col, lum)
    body = mix(math('MULTIPLY', pits, math('SUBTRACT', 1.0, warm)), body, (0.02, 0.02, 0.02, 1.0))
    body = mix(math('MULTIPLY', edge, 0.35 * K), body, (0.6, 0.58, 0.55, 1.0), 'SCREEN')
    glow, glow_col = warm, (1.0, 0.45, 0.08, 1.0)
elif MODE == 'shardling':
    mp = node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (0.6, 0.6, 2.0)
    L.new(coord, mp.inputs[0])
    strata = node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z')
    strata.inputs['Scale'].default_value = 2.5
    strata.inputs['Distortion'].default_value = 10.0
    strata.inputs['Detail'].default_value = 3.0
    strata.inputs['Detail Scale'].default_value = 2.0
    L.new(mp.outputs[0], strata.inputs['Vector'])
    # Faint, warped strata on the sandstone only: the grey slate spikes keep plain grain.
    sand = smooth(S, 0.12, 0.25)
    st = math('MULTIPLY', math('SUBTRACT', strata.outputs['Fac'], 0.5), 0.16 * K)
    st = math('MULTIPLY', st, sand)
    body = scale_col(col, math('ADD', lum, st))
    body = mix(math('MULTIPLY', edge, 0.45 * K), body, (1.0, 0.92, 0.75, 1.0), 'SCREEN')
    glow, glow_col = warm, (1.0, 0.6, 0.15, 1.0)
elif MODE == 'burrower':
    # Fur: the brown-grey, slightly warm areas; stone: the cooler grey plates.
    fur = math('MULTIPLY', band(H, 0.02, 0.15, 0.04), smooth(S, 0.08, 0.2))
    fur = math('MULTIPLY', fur, math('SUBTRACT', 1.0, warm), clamp=True)
    mp = node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (3.0, 3.0, 0.6)
    L.new(coord, mp.inputs[0])
    wave = node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='X')
    wave.inputs['Scale'].default_value = 38.0
    wave.inputs['Distortion'].default_value = 9.0
    wave.inputs['Detail'].default_value = 3.0
    L.new(mp.outputs[0], wave.inputs['Vector'])
    strand = math('MULTIPLY', math('SUBTRACT', wave.outputs['Fac'], 0.5), 0.5 * K)
    fur_l = math('ADD', 1.0, strand)
    body = scale_col(col, math('ADD', math('MULTIPLY', fur, fur_l), math('MULTIPLY', math('SUBTRACT', 1.0, fur), lum)))
    body = mix(math('MULTIPLY', math('MULTIPLY', edge, math('SUBTRACT', 1.0, fur)), 0.4 * K), body, (0.75, 0.75, 0.72, 1.0), 'SCREEN')
    glow, glow_col = warm, (1.0, 0.55, 0.12, 1.0)
else:
    raise SystemExit(f'unknown mode {MODE}')

final = mix(ao_f, (0, 0, 0, 1), body)
emit = node('ShaderNodeEmission')
L.new(final, emit.inputs['Color'])
orig_surface = out.inputs['Surface'].links[0].from_socket
L.new(emit.outputs[0], out.inputs['Surface'])

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 48
sc.render.bake.margin = 8
bpy.context.view_layer.objects.active = obj
obj.select_set(True)


def bake_to(name, path):
    im = bpy.data.images.new(name, 1024, 1024)
    bn = node('ShaderNodeTexImage', image=im)
    for n in N:
        n.select = False
    bn.select = True
    N.active = bn
    bpy.ops.object.bake(type='EMIT')
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()


bake_to('basecolor', OUT_PNG)
# Glow: the lit colour, brightened toward the mask's core, black elsewhere.
g = mix(glow, (0, 0, 0, 1), mix(0.5, col, glow_col))
L.new(g, emit.inputs['Color'])
bake_to('emissive', OUT_EM)
print('BAKED', OUT_PNG, OUT_EM)
