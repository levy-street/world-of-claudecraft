"""The Reins of the Quarryheart Charger item icon (public/ui/items/reins_quarryheart_charger).

A three-quarter portrait of the charger's head from its authoring .blend (build_charger.py
--blend): the stone plates of the skull over the fire, the white-gold eye under a heavy brow,
the two ice-crystal horns sweeping back with the crown between them, and the first of the wind
mane. Warm key from the top left, a cool rim from the right (woc-item-icon-v1,
docs/design/item-icon-art-style.md). The subject renders on transparent film; the shared
compose step (scripts/assets/lantern_hall_steed/compose_icon.py --bloom) paints the low-key ground
and the game's bloom under it, and `npm run assets:items` turns the 512 master into the shipping
128 WebP.

  blender --background <charger.blend> --python \
      scripts/assets/quarryheart_charger/render_reins_icon.py -- <out_subject.png>

Original work for this project.
"""
import math
import sys

import bpy
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1:][0]
sc = bpy.context.scene
arm = bpy.data.objects['QuarryheartCharger']
arm.animation_data.action = bpy.data.actions['Charger|Idle']
sc.frame_set(1)
bpy.context.view_layer.update()

head = arm.matrix_world @ arm.pose.bones['head'].head
target = head + Vector((0, -0.45, -0.05))

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
bg.inputs[1].default_value = 0.5

stone = bpy.data.materials['QuarryheartStone']
bsdf = next(n for n in stone.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Emission Strength'].default_value = 1.6
# the wind ribbons read as a pale sheen in a still (the game draws them with their own shader)
wind = bpy.data.materials['QuarryheartWind']
wb = next(n for n in wind.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
wb.inputs['Alpha'].default_value = 0.35
wb.inputs['Emission Strength'].default_value = 1.6

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.lens = 70
# three-quarter from the charger's left-front (+X is its left, -Y its front), a touch above
ang = math.radians(-50)
cam.location = target + Vector((math.cos(ang) * 4.9, math.sin(ang) * 4.9, 0.35))
cam.rotation_euler = (target + Vector((0, 0, 0.25)) - cam.location).to_track_quat('-Z', 'Y').to_euler()


def light(name, kind, energy, color, loc, size=1.0):
    obj = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
    obj.data.energy = energy
    obj.data.color = color
    if kind == 'AREA':
        obj.data.size = size
    obj.location = loc
    obj.rotation_euler = (target - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(obj)


light('key', 'AREA', 110, (1.0, 0.86, 0.66), target + Vector((1.6, -1.6, 1.8)), 1.4)
light('rim', 'AREA', 120, (0.55, 0.7, 1.0), target + Vector((-1.5, 1.2, 1.0)), 1.2)
light('fill', 'AREA', 18, (0.9, 0.8, 0.7), target + Vector((0.4, -2.0, -0.5)), 2.0)

sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('ICON', OUT)
