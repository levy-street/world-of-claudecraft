# Review renders of Gourdlight Eve's corn shock (Eevee): the street shock from three sides
# and close on the lashing, beside a player-height figure for scale, by day.
#   blender --background --factory-startup --python \
#     scripts/assets/gourdlight_eve/corn_shock_preview.py -- --out <dir> [--tag <prefix>] [--blend <file>]
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M  # noqa: E402
import stall  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[argv.index("--out") + 1]
tag = argv[argv.index("--tag") + 1] if "--tag" in argv else "shock"
blend = argv[argv.index("--blend") + 1] if "--blend" in argv else None
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
col = bpy.data.collections.new("CornShock")
bpy.context.scene.collection.children.link(col)
shock = stall.corn_shock(M, col, "corn_shock", "street-shock")
scale = float(argv[argv.index("--scale") + 1]) if "--scale" in argv else 1.0
for v in shock.data.vertices:
    v.co *= scale
print("CORN_SHOCK tris=%d" % sum(len(p.vertices) - 2 for p in shock.data.polygons))
min_z = min(v.co.z for v in shock.data.vertices)
for v in shock.data.vertices:
    v.co.z -= min_z

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1000
scene.render.resolution_y = 1000
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.5, 0.58, 0.7, 1)
bg.inputs[1].default_value = 0.8
try:
    scene.view_settings.view_transform = "AgX"
except Exception:
    pass

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.2
sun.data.angle = math.radians(3)
sun.rotation_euler = (math.radians(48), 0, math.radians(35))
scene.collection.objects.link(sun)

ground = bpy.data.meshes.new("ground")
ground.from_pydata([(-8, -8, 0), (8, -8, 0), (8, 8, 0), (-8, 8, 0)], [], [(0, 1, 2, 3)])
gobj = bpy.data.objects.new("ground", ground)
gm = bpy.data.materials.new("groundmat")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.12, 0.1, 0.06, 1)
ground.materials.append(gm)
scene.collection.objects.link(gobj)

# a plain figure a player's height (2.6, the game's humanoid) for scale, to the side
bpy.ops.mesh.primitive_cylinder_add(radius=0.3, depth=2.6, location=(2.2, 1.6, 1.3))
fig = bpy.context.active_object
fig.name = "scale_figure"
fm = bpy.data.materials.new("figmat")
fm.use_nodes = True
fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.36, 0.4, 1)
fig.data.materials.append(fm)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.lens = 50


def shoot(name, loc, look):
    cam.location = Vector(loc) * scale
    target = Vector(look) * scale
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out, "%s_%s.png" % (tag, name))
    bpy.ops.render.render(write_still=True)


shoot("front", (0.6, -5.2, 1.6), (0.3, 0, 1.05))
shoot("side", (5.0, 1.2, 1.5), (0.3, 0, 1.05))
shoot("three_quarter_high", (-3.6, -3.6, 3.0), (0, 0, 1.0))
fig.hide_render = True
shoot("lashing_close", (0.4, -1.7, 1.15), (0, 0, 0.98))
shoot("top_close", (0.9, -1.4, 2.6), (0, 0, 1.75))
fig.hide_render = False
if blend:
    bpy.ops.wm.save_as_mainfile(filepath=blend)
