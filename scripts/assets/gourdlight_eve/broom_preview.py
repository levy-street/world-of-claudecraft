# Review renders of the Emberbristle Broom (Eevee): the concept sheet's three orthographic
# views (front, left, back) and a three-quarter beauty shot beside a 1.8 m reference
# figure, by day or by night, at rest or on a clip frame.
#
#   blender --background <broom.blend> --python scripts/assets/gourdlight_eve/broom_preview.py \
#     -- --out <dir> [--night] [--clip Run --at 0.3] [--concept]
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


out = opt("--out")
os.makedirs(out, exist_ok=True)
night = "--night" in argv
res = int(opt("--res", "900"))
scene = bpy.context.scene
engines = [e.identifier for e in scene.render.bl_rna.properties["engine"].enum_items]
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
scene.render.resolution_x = res
scene.render.resolution_y = int(res * 0.62)
world = scene.world or bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.03, 0.035, 0.07, 1) if night else (0.55, 0.6, 0.68, 1)
bg.inputs[1].default_value = 0.4 if night else 1.0
try:
    scene.view_settings.view_transform = "AgX"
except Exception:
    pass
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    b = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if b and mat.name in ("GourdGlow", "GourdInner", "GourdFlesh", "BroomEmber"):
        b.inputs["Emission Strength"].default_value = 6.0 if night else 1.6
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 0.3 if night else 3.4
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
scene.collection.objects.link(sun)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN"))
fill.data.energy = 0.25 if night else 1.1
fill.data.color = (0.6, 0.7, 1.0) if night else (1, 1, 1)
fill.rotation_euler = (math.radians(60), 0, math.radians(150))
scene.collection.objects.link(fill)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
ground = bpy.data.meshes.new("ground")
ground.from_pydata([(-20, -20, -0.75), (20, -20, -0.75), (20, 20, -0.75), (-20, 20, -0.75)], [], [(0, 1, 2, 3)])
gobj = bpy.data.objects.new("ground", ground)
gm = bpy.data.materials.new("groundmat")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.18, 0.15, 0.09, 1)
ground.materials.append(gm)
scene.collection.objects.link(gobj)

rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
clip = opt("--clip", "Idle")
act = bpy.data.actions.get("Broom|" + clip)
rig.animation_data.action = act
if act is not None and act.slots:
    rig.animation_data.action_slot = act.slots[0]
fps = scene.render.fps or 30
scene.frame_set(int(round(1 + float(opt("--at", "0")) * fps)))
bpy.context.view_layer.update()


def look(target, direction, dist, ortho=None):
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = "PERSP"
        cam.data.lens = 50
    cam.location = target + direction.normalized() * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()


def shot(name):
    scene.render.filepath = os.path.join(out, name + ".png")
    bpy.ops.render.render(write_still=True)


tag = "night" if night else "day"
center = Vector((0, 0.1, 0))
if "--concept" in argv:
    for view, d in (("front", Vector((0, -1, 0))), ("left", Vector((1, 0, 0))), ("back", Vector((0, 1, 0)))):
        look(center, d, 8, ortho=3.4)
        shot("concept_%s_%s" % (view, tag))
# a 1.8 m reference figure standing beside it, the broom hovering a hand above the ground
bpy.ops.mesh.primitive_cylinder_add(radius=0.25, depth=1.8, location=(0.9, 0.0, 0.15))
ref = bpy.context.active_object
rm = bpy.data.materials.new("refmat")
rm.use_nodes = True
rm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.15, 0.4, 0.85, 1)
ref.data.materials.append(rm)
look(Vector((0.2, 0.15, -0.05)), Vector((-0.85, -0.75, 0.42)), 5.2)
shot("beauty_%s_%s_%.2f" % (tag, clip, float(opt("--at", "0"))))
look(Vector((0, 0.9, 0.0)), Vector((-0.5, 0.45, 0.35)), 2.4)
shot("head_%s_%s_%.2f" % (tag, clip, float(opt("--at", "0"))))
look(Vector((0, -1.2, 0.0)), Vector((-0.7, -0.6, 0.3)), 1.7)
shot("crook_%s_%s_%.2f" % (tag, clip, float(opt("--at", "0"))))
