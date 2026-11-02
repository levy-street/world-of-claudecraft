# Review renders of Old Thatchgrin and his strawling (Eevee): front, side, three-quarter
# and a scale shot beside a 1.8 m reference figure, by day or by night, plus a strip of
# frames from any clip.
#
#   blender --background <scarecrow.blend> --python scripts/assets/gourdlight_eve/scarecrow_preview.py \
#     -- --out <dir> [--night] [--clip Throw --frames 0,0.5,1.0] [--who thatchgrin|strawling|both]
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


out = opt("--out")
night = "--night" in argv
clip = opt("--clip")
frames = [float(x) for x in opt("--frames", "0").split(",")]
who = opt("--who", "thatchgrin")
res = int(opt("--res", "1100"))
os.makedirs(out, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in scene.render.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.resolution_x = res
scene.render.resolution_y = res
world = scene.world or bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.03, 0.035, 0.07, 1) if night else (0.5, 0.58, 0.7, 1)
bg.inputs[1].default_value = 0.4 if night else 1.0
try:
    scene.view_settings.view_transform = "AgX"
except Exception:
    pass

for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    b = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if b and mat.name in ("GourdFlesh", "GourdInner", "GourdGlow", "ScarecrowGlow", "GourdLitSkin"):
        b.inputs["Emission Strength"].default_value = (8.0 if night else 1.5) * (0.15 if mat.name == "GourdLitSkin" else 1.0)

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 0.25 if night else 3.8
sun.rotation_euler = (math.radians(52), 0, math.radians(-35))
scene.collection.objects.link(sun)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "AREA"))
fill.data.energy = 60 if night else 900
fill.data.size = 6
scene.collection.objects.link(fill)
if night:
    moon = bpy.data.objects.new("moon", bpy.data.lights.new("moon", "SUN"))
    moon.data.energy = 0.6
    moon.data.color = (0.55, 0.65, 1.0)
    moon.rotation_euler = (math.radians(60), 0, math.radians(140))
    scene.collection.objects.link(moon)
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

# the 1.8 m reference figure (a capsule) beside him
ref = None
if "--scale" in argv:
    bpy.ops.mesh.primitive_cylinder_add(radius=0.25, depth=1.8, location=(1.25, 0.15, 0.9))
    ref = bpy.context.active_object
    rm = bpy.data.materials.new("refmat")
    rm.use_nodes = True
    rm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.15, 0.4, 0.85, 1)
    ref.data.materials.append(rm)

rigs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
for r in rigs:
    keep = who == "both" or r.name.lower().startswith(who)
    r.hide_render = not keep
    for c in r.children:
        c.hide_render = not keep
targets = [r for r in rigs if not r.hide_render]

views = {
    "front": Vector((0, -1, 0.12)),
    "side": Vector((1, 0, 0.12)),
    "threequarter": Vector((0.75, -0.85, 0.3)),
}
pick = opt("--views", "front,side,threequarter").split(",")

for r in targets:
    act_name = None
    if clip:
        for a in bpy.data.actions:
            if a.name.endswith("|" + clip) and a.name.lower().startswith(r.name.lower()[:6]):
                act_name = a.name
        r.animation_data.action = bpy.data.actions[act_name]
        if r.animation_data.action.slots:
            r.animation_data.action_slot = r.animation_data.action.slots[0]

for t in frames:
    scene.frame_set(int(round(1 + t * scene.render.fps)))
    bpy.context.view_layer.update()
    pts = []
    for r in targets:
        for c in r.children:
            if c.type == "MESH":
                deps = bpy.context.evaluated_depsgraph_get()
                ev = c.evaluated_get(deps)
                me = ev.to_mesh()
                pts += [c.matrix_world @ me.vertices[i].co for i in range(0, len(me.vertices), 7)]
                ev.to_mesh_clear()
    if ref is not None:
        pts += [Vector((1.25, 0.15, 0)), Vector((1.25, 0.15, 1.8))]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), 0))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr = (lo + hi) / 2
    size = max((hi - lo).length, 1.0)
    for vname in pick:
        d = views[vname].normalized()
        cam.data.lens = 50
        dist = size * 1.55
        cam.location = ctr + d * dist
        cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
        fill.location = ctr + Vector((-d.y, d.x, 0.4)) * dist * 0.6 + Vector((0, 0, size))
        fill.rotation_euler = (ctr - fill.location).to_track_quat("-Z", "Y").to_euler()
        tag = "%s_%s%s_%s%s" % (who, (clip + "_%.2f_" % t) if clip else "", vname, "night" if night else "day", "_scale" if ref else "")
        scene.render.filepath = os.path.join(out, tag + ".png")
        bpy.ops.render.render(write_still=True)
