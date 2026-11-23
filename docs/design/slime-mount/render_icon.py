"""Render the reins icon subject: Wobbles at rest, front three-quarter, warm
top-left key and cool fill, on a transparent film (compose_icon.py adds the
ground).

blender --background --python render_icon.py -- <slime_anim.blend> <icon_raw.png>
"""
import bpy, sys, math
from mathutils import Vector
src, out = sys.argv[sys.argv.index("--")+1:]
bpy.ops.wm.open_mainfile(filepath=src)
sc = bpy.context.scene
rig = next(o for o in sc.objects if o.type == "ARMATURE")
for t in rig.animation_data.nla_tracks:
    t.mute = True
    t.is_solo = False
rig.animation_data.action = None
for b in rig.pose.bones:
    b.location = (0, 0, 0); b.scale = (1, 1, 1); b.rotation_quaternion = (1, 0, 0, 0)
# rest pose shows bubbles at their Idle start points; keep them
for e in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]:
    if "EEVEE" in e: sc.render.engine = e
sc.render.resolution_x = sc.render.resolution_y = 768
sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.22, 0.24, 0.3, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
key = bpy.data.objects.new("key", bpy.data.lights.new("key", "SUN")); key.data.energy = 4.0
key.data.color = (1.0, 0.9, 0.75); key.rotation_euler = (math.radians(50), 0, math.radians(-40)); sc.collection.objects.link(key)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN")); fill.data.energy = 0.8
fill.data.color = (0.6, 0.75, 1.0); fill.rotation_euler = (math.radians(70), 0, math.radians(150)); sc.collection.objects.link(fill)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 60
target = Vector((0, -0.4, 3.2))
d = Vector((0.75, -1.0, 0.55)).normalized()
cam.location = target + d * 19
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
