"""The Lantern Seal's item icon (public/ui/items/lantern_seal.webp): Lantern Hall's contract
token, a gilded octagonal seal with a deep blue enamel field and the guild's lantern in relief
over two crossed swords, on a dark vignette like the Heroic Mark's. Original procedural work
for this project (no imported meshes, no reference art).

  blender --background --factory-startup --python \
      scripts/assets/highwatch_guild/render_lantern_seal_icon.py -- public/ui/items/lantern_seal.webp
"""
import math
import sys

import bpy
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name, color, metal=0.0, rough=0.5, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m


GOLD = mat('Gold', (0.86, 0.6, 0.22), metal=1.0, rough=0.28)
GOLD_DARK = mat('GoldDark', (0.5, 0.32, 0.1), metal=1.0, rough=0.4)
ENAMEL = mat('Enamel', (0.04, 0.08, 0.26), metal=0.2, rough=0.25)
SILVER = mat('Silver', (0.9, 0.92, 0.96), metal=0.6, rough=0.3)
GLOW = mat('Glow', (1.0, 0.62, 0.2), emit=6.0)


def prism(name, sides, r, depth, z, m, rot=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=depth, location=(0, 0, z))
    o = bpy.context.object
    o.name = name
    o.rotation_euler[2] = rot
    o.data.materials.append(m)
    bpy.ops.object.shade_flat()
    return o


def bevel(o, w=0.03):
    mod = o.modifiers.new('b', 'BEVEL')
    mod.width = w
    mod.segments = 2


# the seal: a gilded octagon rim, the enamel field inset, a raised inner ring
bevel(prism('Rim', 8, 1.0, 0.22, 0.0, GOLD, rot=math.pi / 8), 0.05)
prism('Field', 8, 0.82, 0.24, 0.02, ENAMEL, rot=math.pi / 8)
bpy.ops.mesh.primitive_torus_add(major_radius=0.74, minor_radius=0.035, location=(0, 0, 0.15))
bpy.context.object.data.materials.append(GOLD_DARK)

# two crossed swords under the lantern
for sgn in (1, -1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.17))
    blade = bpy.context.object
    blade.scale = (0.09, 1.25, 0.03)
    blade.rotation_euler[2] = sgn * 0.75
    blade.data.materials.append(SILVER)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.19))
    guard = bpy.context.object
    guard.scale = (0.32, 0.06, 0.04)
    guard.rotation_euler[2] = sgn * 0.75
    d = Vector((math.sin(-sgn * 0.75), -math.cos(-sgn * 0.75), 0)) * 0.38
    guard.location = (d.x, d.y, 0.19)
    guard.data.materials.append(GOLD)

# the lantern: a gilded cage round a glowing pane, a peaked cap and a ring
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.02, 0.24))
pane = bpy.context.object
pane.scale = (0.28, 0.36, 0.06)
pane.data.materials.append(GLOW)
for (x, y) in ((-0.17, 0.02), (0.17, 0.02)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, 0.27))
    post = bpy.context.object
    post.scale = (0.05, 0.42, 0.06)
    post.data.materials.append(GOLD)
for y in (-0.2, 0.24):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, y, 0.27))
    bar = bpy.context.object
    bar.scale = (0.42, 0.05, 0.06)
    bar.data.materials.append(GOLD)
bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.3, radius2=0.02, depth=0.2, location=(0, 0.34, 0.27))
cap = bpy.context.object
cap.rotation_euler = (-math.pi / 2, 0, 0)
cap.data.materials.append(GOLD_DARK)
bpy.ops.mesh.primitive_torus_add(major_radius=0.07, minor_radius=0.02, location=(0, 0.49, 0.27),
                                 rotation=(math.pi / 2, 0, 0))
bpy.context.object.data.materials.append(GOLD)

# the light: a key from the upper left, a warm rim, the lantern's own glow
for (loc, energy, color) in (((-3, 3, 5), 900, (1.0, 0.95, 0.88)), ((3, -2, 3), 300, (1.0, 0.7, 0.4)),
                             ((0, 0, 2), 60, (1.0, 0.6, 0.25))):
    light = bpy.data.lights.new('L', 'POINT')
    light.energy = energy
    light.color = color
    o = bpy.data.objects.new('L', light)
    o.location = loc
    scene.collection.objects.link(o)

world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.025, 0.05, 1)
scene.world = world

cam = bpy.data.cameras.new('C')
cam.type = 'ORTHO'
cam.ortho_scale = 2.35
co = bpy.data.objects.new('C', cam)
co.location = (0, -0.35, 6)
co.rotation_euler = (math.radians(4), 0, 0)
scene.collection.objects.link(co)
scene.camera = co

for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        continue
try:
    scene.eevee.taa_render_samples = 64
    scene.eevee.use_bloom = True
except AttributeError:
    pass
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x = scene.render.resolution_y = 128
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'WEBP'
scene.render.image_settings.quality = 90
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('WROTE', OUT)
