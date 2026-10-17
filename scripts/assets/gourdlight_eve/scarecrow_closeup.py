# Close-up review renders of Old Thatchgrin (Eevee): the scythe hand from three angles,
# and a contact sheet of any clip's frames from a fixed camera, so an attack can be read
# beat by beat (anticipation, impact, recovery) beside a 1.8 m reference figure.
#
#   blender --background <scarecrow.blend> --python scripts/assets/gourdlight_eve/scarecrow_closeup.py \
#     -- --out <dir> --hand
#   blender --background <scarecrow.blend> --python scripts/assets/gourdlight_eve/scarecrow_closeup.py \
#     -- --out <dir> --clip Swipe --frames 0,0.3,0.5 [--view front|side|threequarter|top]
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
res = int(opt("--res", "700"))
scene = bpy.context.scene
engines = [e.identifier for e in scene.render.bl_rna.properties["engine"].enum_items]
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
scene.render.resolution_x = res
scene.render.resolution_y = res
world = scene.world or bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.5, 0.58, 0.7, 1)
bg.inputs[1].default_value = 1.0
try:
    scene.view_settings.view_transform = "AgX"
except Exception:
    pass
fps = scene.render.fps or 30

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.6
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
scene.collection.objects.link(sun)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN"))
fill.data.energy = 1.2
fill.rotation_euler = (math.radians(60), 0, math.radians(150))
scene.collection.objects.link(fill)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
ground = bpy.data.meshes.new("ground")
ground.from_pydata([(-40, -40, 0), (40, -40, 0), (40, 40, 0), (-40, 40, 0)], [], [(0, 1, 2, 3)])
gobj = bpy.data.objects.new("ground", ground)
gm = bpy.data.materials.new("groundmat")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.16, 0.08, 1)
ground.materials.append(gm)
scene.collection.objects.link(gobj)

rig = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o.name.lower().startswith("thatch"))
for o in bpy.data.objects:
    if o.type == "ARMATURE" and o is not rig:
        o.hide_render = True
        for c in o.children:
            c.hide_render = True


def look(target, direction, dist, lens=50):
    cam.data.lens = lens
    cam.location = target + direction.normalized() * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()


def set_clip(name):
    act = next((a for a in bpy.data.actions if a.name.endswith("|" + name) and a.name.startswith("Thatchgrin")), None)
    rig.animation_data.action = act
    if act is not None and act.slots:
        rig.animation_data.action_slot = act.slots[0]


def bone_world(name):
    pb = rig.pose.bones[name]
    return rig.matrix_world @ pb.head


# The scythe's landmarks at rest (scarecrow.py build_scythe, s = 1): the grip, the haft's
# two ends and the blade's middle and tip, carried through the posed R_Hand bone.
SCYTHE_REST = {
    "grip": Vector((-2.36, 0.0, 3.08)),
    "top": Vector((-2.36, 0.06, 4.53)),
    "butt": Vector((-2.36, 0.02, 1.08)),
    "blade_mid": Vector((-2.30, -1.07, 4.45)),
    "blade_tip": Vector((-2.24, -1.64, 3.93)),
}


def scythe_points():
    pb = rig.pose.bones["R_Hand"]
    m = rig.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted()
    return {k: m @ v for k, v in SCYTHE_REST.items()}


if "--measure" in argv:
    set_clip(opt("--clip", "Idle"))
    for t in [float(x) for x in opt("--frames", "0").split(",")]:
        scene.frame_set(int(round(1 + t * fps)))
        bpy.context.view_layer.update()
        pts = scythe_points()
        for bn in ("Chest", "R_UpperArm", "R_Forearm", "R_Hand"):
            pts[bn] = rig.matrix_world @ rig.pose.bones[bn].head
        print("MEASURE t=%.2f " % t + " ".join("%s=(%.2f,%.2f,%.2f)" % (k, v.x, v.y, v.z) for k, v in pts.items()))
    sys.exit(0)

if "--hand" in argv:
    set_clip(opt("--clip", "Idle"))
    scene.frame_set(int(round(1 + float(opt("--at", "0")) * fps)))
    bpy.context.view_layer.update()
    h = bone_world("R_Hand")
    tail = rig.matrix_world @ rig.pose.bones["R_Hand"].tail
    c = (h + tail) / 2
    for tag, d in (("front", Vector((0, -1, 0.2))), ("out", Vector((-1, -0.3, 0.2))), ("top", Vector((-0.2, -0.4, 1.0))), ("below", Vector((-0.3, -0.6, -0.5)))):
        look(c, d, 1.6, 50)
        scene.render.filepath = os.path.join(out, "hand_%s.png" % tag)
        bpy.ops.render.render(write_still=True)
    sys.exit(0)

clip = opt("--clip", "Idle")
frames = [float(x) for x in opt("--frames", "0").split(",")]
view = opt("--view", "threequarter")
dirs = {
    "front": Vector((0, -1, 0.12)),
    "side": Vector((-1, 0, 0.12)),
    "threequarter": Vector((-0.75, -0.85, 0.3)),
    "top": Vector((-0.3, -0.5, 1.4)),
    "back": Vector((0.4, 1, 0.3)),
}
# a 1.8 m reference figure (a player) standing where his scythe lands
bpy.ops.mesh.primitive_cylinder_add(radius=0.25, depth=1.8, location=(-1.2, -2.6, 0.9))
ref = bpy.context.active_object
rm = bpy.data.materials.new("refmat")
rm.use_nodes = True
rm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.15, 0.4, 0.85, 1)
ref.data.materials.append(rm)
set_clip(clip)
target = Vector((0, -1.0, 2.1))
for t in frames:
    scene.frame_set(int(round(1 + t * fps)))
    bpy.context.view_layer.update()
    look(target, dirs[view], float(opt("--dist", "11")), 50)
    scene.render.filepath = os.path.join(out, "%s_%s_%05.2f.png" % (clip, view, t))
    bpy.ops.render.render(write_still=True)
