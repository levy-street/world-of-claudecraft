"""Paint the turnaround sheets onto the colossi.

Each statue gets a fresh UV map and one SIZE texture baked from its own sheet: every view (front,
right, back, and a mirrored left where the statue is symmetric) projected orthographically from
its side, registered by the painting's bounding box against the model's projected extent, and
weighted by a sun-shadow bake from that side (how squarely a surface faces the view, zero where
something hides it from the view). Tripo's own paint fills what no view sees (tops, undercuts).
The statue faces -Y in Blender (the game's +z), up +Z, its right -X.

  "<blender>" -b --factory-startup --python scripts/assets/smith_heart_hammer_colossi/project_bake.py -- scripts/assets/smith_heart_hammer_colossi/project.json
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector

cfg = json.load(open(sys.argv[sys.argv.index('--') + 1]))
# Paths in the config are relative to the repo root, where this runs from.
P = os.path.abspath
SIZE = cfg.get('size', 1024)
FALLBACK = cfg.get('fallback', 0.04)
os.makedirs(P(cfg['work']), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=P(cfg['src']))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
world = bpy.data.worlds.new('dark')
world.use_nodes = False
world.color = (0, 0, 0)
scene.world = world
sun_data = bpy.data.lights.new('sun', type='SUN')
sun_data.energy = 1.0
sun_data.angle = math.radians(0.3)
sun = bpy.data.objects.new('sun', sun_data)
scene.collection.objects.link(sun)

# The view's horizontal axis in object space (image right), and the direction its light travels.
VIEWS = {
    'front': {'axis': 'x', 'sign': 1, 'light': Vector((0, 1, 0))},
    'back': {'axis': 'x', 'sign': -1, 'light': Vector((0, -1, 0))},
    'right': {'axis': 'y', 'sign': -1, 'light': Vector((1, 0, 0))},
    'left': {'axis': 'y', 'sign': 1, 'light': Vector((-1, 0, 0))},
}


def float_image(name):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    return img


def pixels(img):
    return np.array(img.pixels[:], dtype=np.float32).reshape(SIZE, SIZE, 4)


def load_raw(path):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    return img


statues = [bpy.data.objects[s['node']] for s in cfg['statues']]
for st in cfg['statues']:
    ob = bpy.data.objects[st['node']]
    for other in statues:
        other.hide_render = other is not ob
    me = ob.data
    mat = me.materials[0]
    nt = mat.node_tree
    tripo = next(n.image for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image)
    tripo.colorspace_settings.name = 'Non-Color'
    old_uv = me.uv_layers[0].name
    bake_uv = me.uv_layers.new(name='bake')
    me.uv_layers.active = bake_uv
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')

    def chain(kind, target, image=None, coeff=None):
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = target
        node.select = True
        nt.nodes.active = node
        if kind == 'vis':
            bsdf = nt.nodes.new('ShaderNodeBsdfDiffuse')
            bsdf.inputs['Color'].default_value = (1, 1, 1, 1)
            nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
            return
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.interpolation = 'Linear'
        if kind == 'old':
            uvn = nt.nodes.new('ShaderNodeUVMap')
            uvn.uv_map = old_uv
            nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        else:
            tex.extension = 'CLIP'
            tc = nt.nodes.new('ShaderNodeTexCoord')
            sep = nt.nodes.new('ShaderNodeSeparateXYZ')
            nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
            mu = nt.nodes.new('ShaderNodeMath')
            mu.operation = 'MULTIPLY_ADD'
            nt.links.new(sep.outputs['X' if coeff['axis'] == 'x' else 'Y'], mu.inputs[0])
            mu.inputs[1].default_value = coeff['au']
            mu.inputs[2].default_value = coeff['bu']
            mv = nt.nodes.new('ShaderNodeMath')
            mv.operation = 'MULTIPLY_ADD'
            nt.links.new(sep.outputs['Z'], mv.inputs[0])
            mv.inputs[1].default_value = coeff['av']
            mv.inputs[2].default_value = coeff['bv']
            comb = nt.nodes.new('ShaderNodeCombineXYZ')
            nt.links.new(mu.outputs[0], comb.inputs['X'])
            nt.links.new(mv.outputs[0], comb.inputs['Y'])
            nt.links.new(comb.outputs['Vector'], tex.inputs['Vector'])
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(tex.outputs['Color'], em.inputs['Color'])
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])

    def bake(kind):
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        if kind == 'EMIT':
            scene.cycles.samples = 1
            bpy.ops.object.bake(type='EMIT', margin=8, use_clear=True, uv_layer='bake')
        else:
            scene.cycles.samples = 16
            bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT'}, margin=8, use_clear=True,
                                uv_layer='bake')

    old_img = float_image(f'{st["name"]}_old')
    chain('old', old_img, image=tripo)
    bake('EMIT')
    old = pixels(old_img)[..., :3]

    reg = json.load(open(os.path.join(P(st['views_dir']), 'registration.json')))
    verts = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
    zmin, zmax = verts[:, 2].min(), verts[:, 2].max()
    num = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    den = np.zeros((SIZE, SIZE, 1), dtype=np.float32)
    for view in st['views']:
        spec = VIEWS[view]
        r = reg[view]
        W, H = r['W'], r['H']
        h = verts[:, 0 if spec['axis'] == 'x' else 1] * spec['sign']
        hmin, hmax = h.min(), h.max()
        au = (r['ix1'] - r['ix0']) / (hmax - hmin) / W
        bu = (r['ix0'] + 0.5) / W - hmin * au
        av = (r['iy1'] - r['iy0']) / (zmax - zmin) / H
        bv = 1 - (r['iy1'] + 0.5) / H - zmin * av
        coeff = {'axis': spec['axis'], 'au': au * spec['sign'], 'bu': bu, 'av': av, 'bv': bv}
        col_img = float_image(f'{st["name"]}_{view}_col')
        fg_img = float_image(f'{st["name"]}_{view}_fg')
        vis_img = float_image(f'{st["name"]}_{view}_vis')
        chain('view', col_img, image=load_raw(os.path.join(P(st['views_dir']), f'{view}.png')), coeff=coeff)
        bake('EMIT')
        chain('view', fg_img, image=load_raw(os.path.join(P(st['views_dir']), f'{view}_fg.png')), coeff=coeff)
        bake('EMIT')
        sun.rotation_mode = 'QUATERNION'
        sun.rotation_quaternion = spec['light'].to_track_quat('-Z', 'Y')
        chain('vis', vis_img)
        bake('DIFFUSE')
        col = pixels(col_img)[..., :3]
        fg = pixels(fg_img)[..., :1]
        vis = pixels(vis_img)[..., :1]
        lit = vis[vis > 0]
        top = float(np.percentile(lit, 99)) if lit.size else 1.0
        vis = np.clip(vis / max(top, 1e-6), 0, 1)
        w = (vis ** 2) * np.clip(fg, 0, 1)
        num += w * col
        den += w
        print('VIEW', st['node'], view, 'covered texels', int((w[..., 0] > 0.05).sum()))
    final = (num + FALLBACK * old) / (den + FALLBACK)
    paint = bpy.data.images.new(f'{st["name"]}_paint', SIZE, SIZE, alpha=False)
    paint.colorspace_settings.name = 'sRGB'
    rgba = np.concatenate([np.clip(final, 0, 1), np.ones((SIZE, SIZE, 1), dtype=np.float32)], axis=2)
    paint.pixels[:] = rgba.ravel()
    paint.filepath_raw = os.path.join(P(cfg['work']), f'{st["name"]}_paint.png')
    paint.file_format = 'PNG'
    paint.save()
    paint.pack()
    # The statue's own material again: the painting through the new UV map, alone.
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.95
    bsdf.inputs['Metallic'].default_value = 0.0
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = paint
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    me.uv_layers.remove(me.uv_layers[old_uv])
    me.uv_layers['bake'].name = 'UVMap'
    print('PAINTED', st['node'], 'view share', round(float((den[..., 0] > FALLBACK).mean()), 3))

for ob in statues:
    ob.hide_render = False
bpy.data.objects.remove(sun, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for ob in statues:
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=P(cfg['out']), export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True, export_animations=False)
print('WROTE', cfg['out'], os.path.getsize(P(cfg['out'])))
