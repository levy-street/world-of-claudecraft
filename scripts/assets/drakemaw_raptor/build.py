"""Build the Drakemaw Raptor mount in Blender: rig, skin and clips, from scratch.

  blender -b --factory-startup --python build.py -- <source.blender.glb> <raw out.glb> [options]

  --stats path    write a JSON of the measurements the manifest and tests pin
  --blend path    also save the authoring .blend (the editable rig and actions)
  -               as the output skips the export

The input is prep.mjs's Blender-readable copy of source/drakemaw_raptor_source.glb
(the Tripo mesh and paint, no rig). The mesh is scaled to its ridden height in
yards, the armature built from anatomy.py, the skin solved by rig.py, every clip
solved by clips.py and keyed by keys.py, and the lot exported as a raw GLB that
ship.mjs turns into the shipping file. Run it through build.mjs, which runs all
three steps.
"""
import json
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anatomy as A  # noqa: E402
import clips as C  # noqa: E402
import keys as K  # noqa: E402
import pose as PO  # noqa: E402
import rig as R  # noqa: E402

T0 = time.time()
MESH_NAME = 'DrakemawRaptor'


def log(*a):
    print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)


def opt(argv, name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


def import_source(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=False, import_shading='NORMALS')
    new = [o for o in bpy.data.objects if o not in before]
    mesh = next(o for o in new if o.type == 'MESH')
    for o in new:
        if o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    mesh.name = mesh.data.name = MESH_NAME
    mesh.scale = (A.SCALE,) * 3
    for o in bpy.context.selected_objects:
        o.select_set(False)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for attr in list(mesh.data.color_attributes):
        mesh.data.color_attributes.remove(attr)
    return mesh


def measure(arm, mesh, rig, clip_stats):
    """What the manifest and the tests pin, read off the built rig."""
    scene = bpy.context.scene
    out = {'scale': A.SCALE, 'bones': len(arm.data.bones), 'clips': clip_stats,
           'blender': bpy.app.version_string}
    # the renderer sizes the model on Idle at min(0.5 s, half its length)
    idle = bpy.data.actions['Idle']
    K.set_action(arm, idle)
    f = min(0.5, idle['frames'] / C.FPS / 2) * C.FPS
    scene.frame_set(int(round(f)))
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    out['idle_sample_frame'] = int(round(f))
    out['idle_top'] = round(max(zs), 5)
    out['idle_min'] = round(min(zs), 5)
    out['idle_height'] = round(max(zs) - min(zs), 5)
    # the Saddle's rest head (Blender axes) and in glTF axes (x, z, -y)
    h = arm.data.bones['Saddle'].head_local
    out['saddle_rest_blender'] = [round(c, 5) for c in h]
    out['saddle_rest_gltf'] = [round(h.x, 5), round(h.z, 5), round(-h.y, 5)]
    out['speeds'] = {'walk': C.WALK_SPEED, 'run': C.RUN_SPEED, 'walkBack': C.BACK_SPEED}
    out['gaits'] = {}
    for name, fn in C.GAITS.items():
        g = fn(rig)
        out['gaits'][name] = {'speed': g.speed, 'seconds': round(g.period, 5), 'duty': g.duty,
                              'sweep': round(g.sweep, 5), 'strides_per_s': round(1.0 / g.period, 4)}
    K.set_action(arm, None)
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    return out


def export(path, arm, mesh):
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    arm.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1,
        export_def_bones=False, export_leaf_bone=False, export_rest_position_armature=True,
        export_reset_pose_bones=True, export_anim_slide_to_zero=False, export_optimize_animation_size=False,
        export_skins=True, export_influence_nb=4, export_all_influences=False, export_morph=False,
        export_vertex_color='NONE', export_attributes=False, export_cameras=False, export_lights=False,
        export_extras=False, export_image_format='AUTO', export_materials='EXPORT', export_tangents=False,
    )
    log('WROTE', path, os.path.getsize(path), 'bytes')


def build(src, out=None, stats_path=None, blend_path=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = C.FPS
    scene.render.fps_base = 1.0
    mesh = import_source(src)
    log('source', len(mesh.data.vertices), 'vertices', len(mesh.data.polygons), 'triangles')
    arm = R.build_armature()
    bones, W, _ = R.weight_skin(mesh, arm)
    log('skin', len(bones), 'bones, max influences', int((W > 0).sum(axis=1).max()))
    rig = PO.Rig(arm)
    rig.ground = R.foot_ground_points(mesh, bones, W)
    clip_stats = C.make_clips(arm, rig)
    log('clips', clip_stats)
    stats = measure(arm, mesh, rig, clip_stats)
    log('idle height', stats['idle_height'], 'top', stats['idle_top'], 'min', stats['idle_min'])
    if out and out != '-':
        export(out, arm, mesh)
        stats['raw_glb_bytes'] = os.path.getsize(out)
    if stats_path:
        with open(stats_path, 'w') as f:
            json.dump(stats, f, indent=1, sort_keys=True)
    if blend_path:
        K.set_action(arm, bpy.data.actions['Idle'])
        scene.frame_start, scene.frame_end = 0, int(bpy.data.actions['Idle']['frames']) - 1
        bpy.ops.wm.save_as_mainfile(filepath=blend_path)
        log('saved', blend_path)
    return stats


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    build(argv[0], argv[1] if len(argv) > 1 else None, opt(argv, '--stats'), opt(argv, '--blend'))
    log('DONE')
