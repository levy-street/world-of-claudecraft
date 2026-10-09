"""Bake some clips onto a delivered Broodsworn .blend and re-export its raw GLB.

  blender -b <key>.blend --python reclip.py -- <key> <Clip,Clip> <out.raw.glb> [--save <out.blend>]

The named actions are (re)authored by this folder's motion.py with config.py's
lengths and contacts; every other action in the .blend is kept as delivered.
The export repeats build.py's: the native half-frame keys are expanded to a
60 fps timeline for the exporter and restored afterwards.
"""
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import SPECS  # noqa: E402
from motion import bake  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
key, names, out = argv[0], argv[1].split(','), argv[2]
spec = dict(SPECS[key], key=key)
spec['clips'] = {n: SPECS[key]['clips'][n] for n in names}
rig = bpy.data.objects['Broodsworn_Rig']
col = bpy.data.collections['Cultist_Export']
meshes = [o for o in col.objects if o.type == 'MESH']
for n in names:
    if n in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[n])
bake(rig, spec, meshes)
print('BAKED', names, flush=True)

scene = bpy.context.scene
curves = []
for action in bpy.data.actions:
    for slot in action.slots:
        for layer in action.layers:
            for strip in layer.strips:
                bag = strip.channelbag(slot)
                if bag:
                    curves.extend(bag.fcurves)
for fc in curves:
    for k in fc.keyframe_points:
        k.co.x = (k.co.x - 1) * 2 + 1
scene.render.fps = 60
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', collection='Cultist_Export', use_active_scene=True,
    export_animations=True, export_animation_mode='ACTIONS', export_anim_single_armature=True,
    export_def_bones=True, export_force_sampling=True, export_bake_animation=True, export_frame_range=False,
    export_frame_step=1, export_anim_slide_to_zero=True, export_skins=True, export_influence_nb=4,
    export_all_influences=False, export_morph=False, export_yup=True, export_extras=True,
    export_optimize_animation_size=False, export_cameras=False, export_lights=False)
for fc in curves:
    for k in fc.keyframe_points:
        k.co.x = (k.co.x - 1) * .5 + 1
scene.render.fps = 30
rig.animation_data.action = bpy.data.actions['Idle']
scene.frame_set(1)
if '--save' in argv:
    bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--save') + 1])
print('RECLIP_DONE', out, flush=True)
