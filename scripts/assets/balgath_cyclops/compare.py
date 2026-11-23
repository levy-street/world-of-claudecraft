"""Old Balgath beside the new one, both at their in-game size (authoring aid).

  blender -b balgath.blend --python compare.py -- <out_dir> <old_full.glb> [--knight k.glb]

<old_full.glb> is the shipped cyclops with its clips merged in and its KTX2
textures decoded to PNG (Blender cannot read KHR_texture_basisu). Both bodies are
scaled to the 13.44-yard height the game draws them at (BALGATH_SCALE 4.2 times
the 3.2-unit visual height), stood at Idle, with a player-sized knight between.
"""
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rig as R  # noqa: E402
import stage  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out, old_path = argv[0], argv[1]
knight = argv[argv.index('--knight') + 1] if '--knight' in argv else None
GAME_H = 13.44
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.startswith('Balgath'))
for o in scene.objects:
    if '_hi' in o.name:
        o.hide_render = True
body = next(o for o in scene.objects if o.type == 'MESH' and o.parent == arm)


def height(meshes):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    zs = []
    for m in meshes:
        ev = m.evaluated_get(dg)
        zs += [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    return min(zs), max(zs)


R.set_action(arm, bpy.data.actions['Idle'])
scene.frame_set(13)
lo, hi = height([body])
k_new = GAME_H / (hi - lo)
holder = bpy.data.objects.new('NewScale', None)
scene.collection.objects.link(holder)
arm.parent = holder
holder.scale = (k_new,) * 3
holder.location = (7.5, 0, 0)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=old_path)
new = [o for o in bpy.data.objects if o not in before]
for o in list(new):
    if o.type == 'MESH' and o.parent is None and o.name.startswith('Icosphere'):
        new.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
old_arm = next(o for o in new if o.type == 'ARMATURE')
old_mesh = [o for o in new if o.type == 'MESH']
act = bpy.data.actions.get('Idle.001') or next(a for a in bpy.data.actions if a.name.startswith('Idle') and a.name != 'Idle')
old_arm.animation_data_create()
old_arm.animation_data.action = act
if act.slots:
    old_arm.animation_data.action_slot = act.slots[0]
scene.frame_set(13)
old_holder = bpy.data.objects.new('OldScale', None)
scene.collection.objects.link(old_holder)
old_arm.parent = old_holder
lo, hi = height(old_mesh)
k_old = GAME_H / (hi - lo)
old_holder.scale = (k_old,) * 3
old_holder.rotation_euler = (0, 0, math.radians(-90))
bpy.context.view_layer.update()
lo, hi = height(old_mesh)
old_holder.location = (-8.5, 0, -lo)
cam = stage.setup(knight=knight, ref_at=(0.0, -2.0, 0.0), engine='CYCLES', res=(1800, 1000))
scene.cycles.samples = 48
for name, az, el, dist, focus, lens in (('lado_a_lado_frente', 0, 6, 46, (0, 0, 6.8), 40),
                                         ('lado_a_lado_tres_cuartos', 28, 9, 48, (0, 0, 6.8), 40),
                                         ('lado_a_lado_perfil', 90, 5, 46, (0, 0, 6.8), 40)):
    stage.aim(cam, az, el, dist, focus, lens)
    stage.still(os.path.join(out, f'{name}.png'))
print('COMPARE_DONE')
