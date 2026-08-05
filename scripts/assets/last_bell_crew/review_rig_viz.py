"""Render a rig as real geometry over a ghosted body, so bone-vs-mesh is VISIBLE.

Blender's bone overlay only exists inside the viewport, and the review loop here needs
committed images that can be compared side by side across iterations. So the bones are
emitted as actual meshes (a tapered shaft per bone, a ball at each joint) and rendered
through the same preview.py lighting the concept plates use. The body is ghosted back so
a chain hiding inside the torso still reads.

Colour says which chain a bone belongs to: the arm chain is what is being fixed, so it
is warm; torso is neutral; legs are cool.

Usage:
  blender -b -P tmp/rig_viz.py -- <glb> <outdir> [clip] [frame] [alpha]
    clip/frame: omit or "-" for the REST pose
"""

import math
import os
import sys

import bpy
from mathutils import Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import preview  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
NAME, OUTDIR = argv[0], os.path.join(REPO, "tmp", argv[1])
CLIP = argv[2] if len(argv) > 2 and argv[2] != "-" else None
FRAME = int(argv[3]) if len(argv) > 3 and argv[3] != "-" else None
ALPHA = float(argv[4]) if len(argv) > 4 else 0.16
os.makedirs(OUTDIR, exist_ok=True)

ARM = ("upperarm", "lowerarm", "wrist", "hand", "handslot")
LEG = ("upperleg", "lowerleg", "foot", "toes")
COLOURS = {
    "arm": (1.00, 0.22, 0.10),
    "torso": (0.95, 0.85, 0.30),
    "leg": (0.20, 0.55, 1.00),
}

for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
             bpy.data.actions, bpy.data.images, bpy.data.collections, bpy.data.lights,
             bpy.data.cameras):
    for item in list(coll):
        try:
            coll.remove(item)
        except Exception:
            pass

seed = bpy.data.objects.new("ctx_seed", None)
bpy.context.scene.collection.objects.link(seed)
bpy.context.view_layer.objects.active = seed
SRC = (os.path.join(REPO, NAME) if "/" in NAME
       else os.path.join(REPO, "public/models/chars/npcs", NAME))
bpy.ops.import_scene.gltf(filepath=SRC)
bpy.data.objects.remove(seed, do_unlink=True)
for o in [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("Icosphere")]:
    bpy.data.objects.remove(o, do_unlink=True)

body = next(o for o in bpy.data.objects if o.type == "MESH")
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")

if CLIP:
    preview.pose(rig, CLIP, FRAME)
else:
    rig.data.pose_position = "REST"
bpy.context.view_layer.update()


def emissive(name, rgb, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (*rgb, 1.0)
    em.inputs[1].default_value = 1.6
    if alpha >= 1.0:
        nt.links.new(em.outputs[0], out.inputs[0])
    else:
        mix = nt.nodes.new("ShaderNodeMixShader")
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix.inputs[0].default_value = alpha
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs[0])
        for attr, val in (("blend_method", "BLEND"), ("surface_render_method", "BLENDED")):
            try:
                setattr(mat, attr, val)
            except Exception:
                pass
    return mat


mats = {k: emissive(f"viz_{k}", v) for k, v in COLOURS.items()}

# ghost the body so a buried chain still reads through it
ghost = emissive("viz_ghost", (0.55, 0.60, 0.72), ALPHA)
body.data.materials.clear()
body.data.materials.append(ghost)


def group_of(bone_name):
    stem = bone_name.split(".")[0]
    if stem in ARM:
        return "arm"
    if stem in LEG:
        return "leg"
    return "torso"


def shaft(a, b, radius, mat, name):
    """A tapered shaft from a to b, so a bone's direction is unambiguous."""
    d = b - a
    if d.length < 1e-6:
        return
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=radius, radius2=radius * 0.35,
                                    depth=d.length, location=(0, 0, 0))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = d.to_track_quat("Z", "Y")
    ob.location = a + d * 0.5


def ball(p, radius, mat, name):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=p)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)


RW = rig.matrix_world
made = []
for pb in rig.pose.bones:
    g = group_of(pb.name)
    h, t = RW @ pb.head, RW @ pb.tail
    rad = max(0.018, min(0.045, pb.bone.length * 0.13))
    shaft(h, t, rad, mats[g], f"viz_{pb.name}")
    ball(h, rad * 1.5, mats[g], f"vizj_{pb.name}")
    made.append(pb.name)

viz = [o for o in bpy.data.objects if o.name.startswith(("viz_", "vizj_")) and o.type == "MESH"]

cam = preview.setup(res=(720, 900), transparent=False)
bpy.context.scene.render.image_settings.file_format = "PNG"
target, dist = preview.fit([body], pad=1.55)
label = CLIP or "rest"
for yaw, pitch, tag in ((0, 4, "front"), (90, 4, "side"), (38, 16, "3q"), (0, 78, "top")):
    preview.shoot(cam, os.path.join(OUTDIR, f"{label}_{tag}.png"), target, dist, yaw, pitch)

print(f"RIGVIZ {NAME} pose={label} bones={len(made)} proxies={len(viz)} -> {OUTDIR}")
