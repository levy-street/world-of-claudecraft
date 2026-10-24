"""Rebuild a wolf's skeleton, skin weights and clips, and export the raw GLB.

  blender -b --factory-startup --python scripts/assets/wolf_rig/build.py -- \
      --model wolf_basic --body tmp/wolf_rig/wolf_basic_view.glb \
      --ref tmp/wolf_rig/wolf_basic_dogrig_view.glb --out tmp/wolf_rig/wolf_basic_raw.glb \
      [--blend tmp/wolf_rig/wolf_basic.blend] [--clips Idle,Walk]

Inputs are Blender-readable copies made by to_blender.mjs (Blender's glTF importer
refuses KTX2 textures and meshopt buffers):
  --body  the shipped wolf: its mesh, UVs and texture are kept exactly
  --ref   the wolf as it shipped on the old dog rig (git show e201d764db:<path>):
          its clips are the motion every new clip is carried from (motion.py)
Either may be the same file. The output still carries a PNG texture and plain
buffers; ship.mjs turns it into the game file (the shipped KTX2 texture back,
meshopt, checks) and then the media manifest picks it up.

The whole pipeline: README.md beside this file.
"""
import argparse
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anatomy  # noqa: E402
import animate  # noqa: E402
import motion  # noqa: E402
import rig  # noqa: E402

T0 = time.time()


def log(*a):
    print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)


def parse():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--model', required=True, choices=sorted(anatomy.MODELS))
    p.add_argument('--body', required=True)
    p.add_argument('--ref', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--blend')
    p.add_argument('--clips')
    return p.parse_args(argv)


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials,
                 bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)


def import_glb(path, tag):
    objs, acts = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    new_objs = [o for o in bpy.data.objects if o not in objs]
    new_acts = [a for a in bpy.data.actions if a not in acts]
    for a in new_acts:
        a.name = tag + a.name
        a.use_fake_user = True
    return new_objs, new_acts


def skinned_mesh(objs):
    meshes = [o for o in objs if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
    if len(meshes) != 1:
        raise RuntimeError(f'expected one skinned mesh, found {[o.name for o in meshes]}')
    return meshes[0]


def detached_body(src, name):
    """A plain copy of the shipped mesh in its rest pose: no armature, no groups."""
    body = src.copy()
    body.data = src.data.copy()
    body.name = name
    body.data.name = name
    body.parent = None
    body.matrix_world = src.matrix_world.copy()
    body.modifiers.clear()
    body.vertex_groups.clear()
    bpy.context.scene.collection.objects.link(body)
    return body


def main():
    a = parse()
    model = anatomy.MODELS[a.model]
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = motion.FPS
    scene.render.fps_base = 1.0

    ref_objs, _ = import_glb(a.ref, 'REF_')
    ref_arm = next(o for o in ref_objs if o.type == 'ARMATURE')
    if os.path.abspath(a.body) == os.path.abspath(a.ref):
        body_src, body_objs = skinned_mesh(ref_objs), []
    else:
        body_objs, body_acts = import_glb(a.body, 'BODY_')
        body_src = skinned_mesh(body_objs)
        for act in body_acts:
            bpy.data.actions.remove(act)
    body = detached_body(body_src, 'Greyboy')
    log('body', len(body.data.vertices), 'corners,', len(body.data.polygons), 'triangles')

    arm = rig.build_armature(model, 'WolfRig')
    report = rig.skin(model, body, arm)
    body.parent = arm
    log('skinned', report)

    only = set(a.clips.split(',')) if a.clips else None
    built = animate.build_all(arm, ref_arm, body, model['ground_z'], lambda n: bpy.data.actions['REF_' + n],
                              only=only, tuck_min=model.get('tuck_min', 0.0))
    for name, (act, T) in built.items():
        log(f'  {name:20s} {T:5.3f} s')

    # export only the new wolf: drop every imported object and the old clips
    for o in ref_objs + body_objs:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    for act in list(bpy.data.actions):
        if act.name.startswith(('REF_', 'BODY_')):
            bpy.data.actions.remove(act)
    motion.set_action(arm, None)
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.blend))
    for o in bpy.context.view_layer.objects:
        o.select_set(o in (arm, body))
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(a.out), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS', export_frame_range=False,
        export_force_sampling=True, export_frame_step=1, export_anim_slide_to_zero=True,
        export_def_bones=False, export_leaf_bone=False, export_skins=True, export_influence_nb=4,
        export_all_influences=False, export_morph=False, export_optimize_animation_size=False,
        export_reset_pose_bones=True, export_bake_animation=False, export_yup=True, export_apply=False,
        export_materials='EXPORT', export_image_format='AUTO')
    log('wrote', a.out)


main()
