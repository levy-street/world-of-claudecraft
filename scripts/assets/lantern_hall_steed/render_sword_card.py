"""The Blade of Lantern Hall's Armory card and bag icon (public/ui/store/armory/lantern_hall_sword.webp,
public/ui/weapons/lantern_hall_sword.jpg), rendered from the shipped sword GLB.

The card follows the store thumbnails' layout (scripts/armory_thumbs.mjs: the blade on a diagonal,
point up, over a dark rarity-warm ground, its fire lit). The fire is lit the way the game lights
it: the albedo's bright, saturated amber texels (the weapon VFX's emissive window,
src/render/weapon_vfx.ts) drive an emission, and compose_icon.py --bloom blooms it.

  blender --background --factory-startup --python \
      scripts/assets/lantern_hall_steed/render_sword_card.py -- \
      public/models/weapons/lantern_hall_sword.glb <out_subject.png>

The render is the SUBJECT on a transparent film; compose_icon.py paints the ground under it.
Original work for this project.
"""
import math
import sys

import bpy
from mathutils import Euler, Vector

GLB, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
sword = next(o for o in bpy.data.objects if o.type == 'MESH')
# lay the blade on the card's diagonal: point to the top right
sword.rotation_mode = 'XYZ'
sword.rotation_euler = Euler((0, math.radians(38), 0), 'XYZ')
sword.location = (0, 0, 0)

# light the fire: emission where the albedo is bright, saturated amber
mat = sword.data.materials[0]
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE' and 'color' in n.image.name)
hsv = nt.nodes.new('ShaderNodeSeparateColor')
hsv.mode = 'HSV'
nt.links.new(tex.outputs['Color'], hsv.inputs['Color'])
sat = nt.nodes.new('ShaderNodeMath')
sat.operation = 'GREATER_THAN'
sat.inputs[1].default_value = 0.72
nt.links.new(hsv.outputs['Green'], sat.inputs[0])
val = nt.nodes.new('ShaderNodeMath')
val.operation = 'GREATER_THAN'
val.inputs[1].default_value = 0.55
nt.links.new(hsv.outputs['Blue'], val.inputs[0])
mask = nt.nodes.new('ShaderNodeMath')
mask.operation = 'MULTIPLY'
nt.links.new(sat.outputs[0], mask.inputs[0])
nt.links.new(val.outputs[0], mask.inputs[1])
strength = nt.nodes.new('ShaderNodeMath')
strength.operation = 'MULTIPLY'
strength.inputs[1].default_value = 3.2
nt.links.new(mask.outputs[0], strength.inputs[0])
nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
nt.links.new(strength.outputs[0], bsdf.inputs['Emission Strength'])

sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = sc.render.resolution_y = 512
sc.render.film_transparent = True
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.08, 0.05, 0.04, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.5

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = 'ORTHO'
bpy.context.view_layer.update()
# frame the blade from its own world bounds (the optimized GLB carries a quantization transform)
pts = [sword.matrix_world @ v.co for v in sword.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre = (lo + hi) / 2
cam.data.ortho_scale = max(hi.x - lo.x, hi.z - lo.z) * 1.22
cam.location = centre + Vector((0, -12, 0))
cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()


def light(name, energy, color, loc, size):
    obj = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
    obj.data.energy = energy
    obj.data.color = color
    obj.data.size = size
    obj.location = loc
    obj.rotation_euler = (centre - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(obj)


light('key', 90, (1.0, 0.86, 0.68), centre + Vector((-1.6, -2.2, 1.8)), 1.5)
light('rim', 70, (1.0, 0.55, 0.25), centre + Vector((1.8, 1.4, 0.4)), 1.2)
light('fill', 12, (0.6, 0.7, 1.0), centre + Vector((1.0, -2.0, -1.2)), 2.0)

sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('CARD', OUT)
