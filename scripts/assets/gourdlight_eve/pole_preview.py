# Review renders of Old Thatchgrin on his pole (round 10): the Pole loop and frames of
# the Awaken clip, with a stand-in post and crossbar placed where the renderer seats them
# (src/render/scarecrow_fx_core.ts POLE_POST_BACK / POLE_BAR_HEIGHT, in model metres here).
#
#   blender --background <thatch.blend> --python scripts/assets/gourdlight_eve/pole_preview.py \
#     -- --out <dir> [--clip Pole|Awaken] [--frames 0,1.0] [--night]
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


out = opt("--out")
clip = opt("--clip", "Pole")
frames = [float(x) for x in opt("--frames", "0").split(",")]
night = "--night" in argv
os.makedirs(out, exist_ok=True)

# model metres (the renderer's world numbers are these times the 7.4 / 5.1 normalization)
POST_BACK = 0.44
BAR_Z = 3.66
POST_TOP = 4.55
BAR_HALF = 2.55

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [
    e.identifier for e in scene.render.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
world = scene.world or bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.03, 0.035, 0.07, 1) if night else (0.5, 0.58, 0.7, 1)
bg.inputs[1].default_value = 0.5 if night else 1.0

wood = bpy.data.materials.new("PreviewPole")
wood.use_nodes = True
wood.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.15, 0.07, 1)
bpy.ops.mesh.primitive_cylinder_add(radius=0.11, depth=POST_TOP + 0.4, location=(0, POST_BACK, (POST_TOP - 0.4) / 2))
bpy.context.object.data.materials.append(wood)
bpy.ops.mesh.primitive_cylinder_add(radius=0.08, depth=BAR_HALF * 2, location=(0, POST_BACK - 0.14, BAR_Z),
                                    rotation=(0, math.pi / 2, 0))
bpy.context.object.data.materials.append(wood)
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
ground = bpy.data.materials.new("PreviewGround")
ground.use_nodes = True
ground.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.25, 0.12, 1)
bpy.context.object.data.materials.append(ground)

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 0.6 if night else 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o.name.startswith("Thatchgrin"))
act = bpy.data.actions["Thatchgrin|" + clip]
arm.animation_data_create()
arm.animation_data.action = act

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
for f in frames:
    scene.frame_set(int(round(1 + f * 30)))
    for view, loc in (("front", (2.0, -9.0, 2.6)), ("side", (9.0, 1.0, 2.6))):
        cam.location = Vector(loc)
        cam.rotation_euler = (Vector((0, 0, 2.3)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out, "%s_%s_%.2f.png" % (clip, view, f))
        bpy.ops.render.render(write_still=True)
