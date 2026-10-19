# Preview renders of the Gourdlight Eve props (Eevee, GPU): one turntable-style
# still per piece by day and with the glow up by night, for the art review.
#   blender --background <gourdlight.blend> --python scripts/assets/gourdlight_eve/preview.py -- --out <dir>
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[argv.index("--out") + 1]
night = "--night" in argv
os.makedirs(out, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.film_transparent = False
world = bpy.data.worlds.new("w") if not scene.world else scene.world
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.02, 0.025, 0.05, 1) if night else (0.42, 0.5, 0.62, 1)
bg.inputs[1].default_value = 0.35 if night else 1.0
try:
    scene.eevee.use_bloom = True
except Exception:
    pass
scene.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"

for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    b = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if b and mat.name in ("GourdFlesh", "GourdInner", "GourdGlow", "LanternPaper"):
        b.inputs["Emission Strength"].default_value = 6.0 if night else 0.6

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 0.3 if night else 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "AREA"))
fill.data.energy = 20 if night else 120
fill.data.size = 3
scene.collection.objects.link(fill)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
ground = bpy.data.meshes.new("ground")
ground.from_pydata([(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
gobj = bpy.data.objects.new("ground", ground)
gm = bpy.data.materials.new("groundmat")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.16, 0.13, 0.09, 1)
ground.materials.append(gm)
scene.collection.objects.link(gobj)

pieces = [o for o in bpy.data.objects if o.type == "MESH" and o.name not in ("ground",)]
for o in pieces:
    o.hide_render = True
for o in pieces:
    o.hide_render = False
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    ctr = (lo + hi) / 2
    size = max((hi - lo).length, 0.2)
    gobj.location = (ctr.x, ctr.y, lo.z)
    d = size * 1.25
    cam.location = ctr + Vector((d * 0.55, -d * 1.0, d * 0.45))
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 50
    fill.location = ctr + Vector((-d, -d * 0.6, d))
    fill.rotation_euler = (ctr - fill.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out, "%s_%s.png" % (o.name, "night" if night else "day"))
    bpy.ops.render.render(write_still=True)
    o.hide_render = True
