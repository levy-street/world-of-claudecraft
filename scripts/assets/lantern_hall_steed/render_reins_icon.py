"""The Reins of the Lantern Hall Destrier item icon (public/ui/items/reins_lantern_hall_destrier).

A three-quarter portrait of the destrier's barded head from the shipped GLB: the steel
chanfron with the guild's lantern lit on the brow, the crinet lames down the crest of the neck,
the bridle and its gilt rosettes. Warm key from the top left, a cool rim from the right, on a
low-key navy-to-umber painted ground (woc-item-icon-v1, docs/design/item-icon-art-style.md).
The 512 master is converted to the shipping 128 WebP by `npm run assets:items`.

  blender --background --factory-startup --python \
      scripts/assets/lantern_hall_steed/render_reins_icon.py -- \
      public/models/mounts/lantern_hall_destrier.glb <out_subject.png>

The render is the SUBJECT only (transparent film); compose_icon.py paints the ground under it.
Original work for this project.
"""
import math
import sys

import bpy
from mathutils import Vector

GLB, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
for o in list(bpy.data.objects):
    if o.name.startswith('Icosphere'):
        bpy.data.objects.remove(o)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
arm.animation_data_create()
arm.animation_data.action = bpy.data.actions['Idle']
if getattr(arm.animation_data.action, 'slots', None):
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
sc = bpy.context.scene
sc.frame_set(0)
bpy.context.view_layer.update()

head = arm.matrix_world @ arm.pose.bones['head.x_031'].head
neck = arm.matrix_world @ arm.pose.bones['neck.x_027'].head
# frame the head and the top of the neck: aim a little below the poll, toward the muzzle
target = head.lerp(neck, 0.45) + Vector((0, -0.08, -0.1))

sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = sc.render.resolution_y = 512
sc.render.film_transparent = True
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.05, 0.06, 0.1, 1)
bg.inputs[1].default_value = 0.6

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.lens = 85
# three-quarter from the horse's left-front, a touch above the eye line
ang = math.radians(-58)
cam.location = target + Vector((math.cos(ang) * 2.45, math.sin(ang) * 2.45, 0.42))
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()


def light(name, kind, energy, color, loc, size=1.0):
    obj = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
    obj.data.energy = energy
    obj.data.color = color
    if kind == 'AREA':
        obj.data.size = size
    obj.location = loc
    obj.rotation_euler = (target - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(obj)


# warm key top-left of frame, cool rim from behind-right, a low fill
light('key', 'AREA', 260, (1.0, 0.86, 0.66), target + Vector((0.9, -1.2, 1.4)), 1.2)
light('rim', 'AREA', 180, (0.55, 0.68, 1.0), target + Vector((-1.2, 0.9, 0.6)), 1.0)
light('fill', 'AREA', 40, (0.9, 0.8, 0.7), target + Vector((0.2, -1.6, -0.4)), 2.0)
# the brow lantern's own fire on the steel around it
light('brow', 'POINT', 6, (1.0, 0.55, 0.2), head + Vector((0, -0.22, 0.05)))

sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('ICON', OUT)
