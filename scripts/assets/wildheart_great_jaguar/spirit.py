"""The jade spirit variant of the Great Jaguar (Zulgar's Jaguar Avatar overlay, and
the Fanglord's Whistle spirit jaguar): the SAME mesh, armature and clips with one
ghostly jade material, exported as a second GLB.

  blender -b great_jaguar.blend --python spirit.py -- <out.glb> [--render dir --knight k.glb]

The material (glTF-portable, no custom shader needed):
  * baseColor: a deep jade constant (0.02, 0.2, 0.12), alpha 0.5, alphaMode BLEND;
  * emissive: a 1024 map built from the baked albedo: the rosettes, spots and paint
    (the dark marks) burn bright jade, the coat a dim jade, the eyes white-jade;
    emissiveFactor 1 with KHR_materials_emissive_strength 2.2;
  * the baked normal map is kept, so the muscles and fur still catch light;
  * roughness 0.35, metallic 0, double-sided off.
"""
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build  # noqa: E402
import rig as R  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name.startswith('GreatJaguar'))
body = bpy.data.objects['GreatJaguar']
src = body.data.materials[0]
alb_img = bpy.data.images['JaguarAlbedo']
nrm_img = bpy.data.images['JaguarNormal']
w, h = alb_img.size
alb = np.array(alb_img.pixels[:], dtype=np.float32).reshape(h, w, 4)
k = max(1, w // 1024)
alb = build.downsample(alb, k) if k > 1 else alb
lum = alb[..., 0] * 0.3 + alb[..., 1] * 0.55 + alb[..., 2] * 0.15
dark = np.clip((0.22 - lum) / 0.2, 0, 1) ** 0.8            # rosettes, spots, lips, ear backs
light = np.clip((lum - 0.55) / 0.35, 0, 1)                   # the pale belly, paint, bone and teeth
glow = 0.16 + 0.26 * light + 0.95 * dark
jade_dim = np.array((0.05, 0.42, 0.26))
jade_hot = np.array((0.45, 1.0, 0.72))
em = jade_dim[None, None, :] * (1 - dark[..., None]) + jade_hot[None, None, :] * dark[..., None]
em = em * glow[..., None]
emis = np.ones((em.shape[0], em.shape[1], 4), dtype=np.float32)
emis[..., :3] = np.clip(em, 0, 1)
em_img = build.to_numpy_image('JaguarSpiritEmissive', emis)

mat = bpy.data.materials.new('JaguarSpirit')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (0.02, 0.2, 0.12, 1)
bsdf.inputs['Alpha'].default_value = 0.5
bsdf.inputs['Roughness'].default_value = 0.35
bsdf.inputs['Metallic'].default_value = 0.0
ie = nt.nodes.new('ShaderNodeTexImage')
ie.image = em_img
nt.links.new(ie.outputs['Color'], bsdf.inputs['Emission Color'])
bsdf.inputs['Emission Strength'].default_value = 2.2
inn = nt.nodes.new('ShaderNodeTexImage')
inn.image = nrm_img
nm = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(inn.outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
try:
    mat.surface_render_method = 'BLENDED'
except Exception:  # noqa: BLE001
    pass
try:
    mat.blend_method = 'BLEND'
except Exception:  # noqa: BLE001
    pass
mat.use_backface_culling = True
body.data.materials.clear()
body.data.materials.append(mat)

if opt('--tex'):
    em_img.filepath_raw = os.path.join(opt('--tex'), 'jaguar_spirit_emissive_1024.png')
    em_img.file_format = 'PNG'
    em_img.save()

build.export(out, arm)
print('SPIRIT_WROTE', out, os.path.getsize(out))

if opt('--render'):
    import stage
    rd = opt('--render')
    cam = stage.setup(knight=opt('--knight'), engine='CYCLES', res=(1600, 1000), sky=(0.03, 0.05, 0.06))
    bpy.context.scene.cycles.samples = 64
    bpy.context.scene.view_settings.exposure = 0.4
    for o in bpy.context.scene.objects:
        if o.type == 'LIGHT':
            o.data.energy *= 0.25
    for clip, t, nm_, az in (('Idle', 0.5, 'espiritu_jade', 38), ('Pounce', 1.25, 'espiritu_jade_salto', 70),
                             ('Roar', 0.9, 'espiritu_jade_rugido', 20)):
        act = bpy.data.actions[clip]
        R.set_action(arm, act)
        f = act.frame_range[0] + t * R.FPS
        bpy.context.scene.frame_set(int(f))
        stage.aim(cam, az, 10, 19.0, (0.0, 0.2, 2.4), 45)
        stage.still(os.path.join(rd, nm_ + '.png'))
print('SPIRIT_DONE')
