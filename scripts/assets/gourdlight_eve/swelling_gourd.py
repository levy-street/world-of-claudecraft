# The Swelling Gourd: the giant pumpkin Old Thatchgrin's patch heaves up mid-fight
# (src/sim/seasonal/scarecrow_swell.ts). A deterministic Blender factory for one rigged,
# animated, vertex-coloured GLB in the scarecrow kit's style (model.py's carved pumpkin):
#
#   a huge, deep-orange carved pumpkin with an angry fanged face lit from inside, about two
#   metres across (drawn well over a player's height), split by glowing seams that run down
#   from its stem and out from its grin (the fire inside pushing out as it ripens), its
#   stem a gnarled, twisting stalk, and thick vines clawing out across the ground round its
#   base where it tore up out of the stubble, with a few curled autumn leaves.
#
# Materials (the runtime contract, src/render/characters/manifest.ts): the carved pumpkin's
# GourdLitSkin, GourdInner, GourdFlesh, GourdGlow (the candle, driven by name), GourdStem,
# plus Leaf and GourdGlow seams.
#
# RIG: Root > Body (the whole gourd) > Stem; the vines ride Root. CLIPS at 30 fps:
#   Idle   2.0 s  a slow heave, the gourd breathing in and out, the stem nodding
#   Death  1.4 s  it splits and slumps: tips back, squashes flat and sinks into the stubble
# The swell over its fuse and the burst are the renderer's (scarecrow_fx.ts), timed to the
# sim's fuse, never baked here.
#
#   blender --background --factory-startup --python \
#     scripts/assets/gourdlight_eve/swelling_gourd.py -- --out <glb> [--blend <file>]
#
# Determinism: no clock, no `random`; every variation is a sha256 of a tag (model.h01).

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M  # noqa: E402

TAU = math.pi * 2.0
FPS = 30
RADIUS = 1.0
HEIGHT = 1.45


def surface_r(z, phi):
    """The rind's radius at height z (from the centre) and angle phi, close to
    pumpkin_bm's lobed spheroid: what the seams and vines sit against."""
    zn = max(-1.0, min(1.0, z / (HEIGHT * 0.5)))
    lobe = 0.93 + 0.07 * M.rib_profile(phi, 12)
    return RADIUS * math.sqrt(max(0.0, 1.0 - zn * zn)) * lobe


def build_seams(coll):
    """Glowing cracks: jagged seams down from the stem well and out from the mouth."""
    bm = bmesh.new()
    seams = []
    for i in range(7):
        phi0 = (i / 7) * TAU + 0.4 + 0.2 * M.hs("seam-phi", i)
        pts = []
        for k in range(9):
            t = k / 8
            z = HEIGHT * (0.42 - 0.62 * t)
            phi = phi0 + 0.07 * M.hs("seam", i, k)
            r = surface_r(z, phi) * 1.01 + 0.01
            pts.append(Vector((math.cos(phi) * r, math.sin(phi) * r, z)))
        seams.append(pts)
    for pts in seams:
        M.tube_bm(bm, pts, 0.03, 5)
    obj = M.new_object("SwellingGourd_seams", bm, coll)
    M.set_materials(obj, ["GourdGlow"])
    return obj


def build_vines(coll):
    """Thick vines clawing out over the ground from the base, with curled leaves."""
    bm = bmesh.new()
    leaves = bmesh.new()
    for i in range(6):
        a = (i / 6) * TAU + 0.3 * M.hs("vine-a", i)
        pts = []
        for k in range(10):
            t = k / 9
            r = RADIUS * (0.55 + 1.0 * t)
            ang = a + 0.5 * math.sin(t * 2.4 + i)
            z = -HEIGHT * 0.5 + 0.08 + 0.12 * math.sin(t * math.pi) - 0.06 * t
            pts.append(Vector((math.cos(ang) * r, math.sin(ang) * r, z)))
        M.tube_bm(bm, pts, 0.11 - 0.005 * i, 7)
        # a curl at the end and two leaves along it
        end = pts[-1]
        for j, t in enumerate((0.45, 0.8)):
            p = pts[int(t * 9)]
            lb = M.leaf_bm("vine-leaf-%d-%d" % (i, j), 0.36, (0, 0, 0), M.h01("vl", i, j) * TAU, 0.08)
            for v in lb.verts:
                v.co = v.co + p + Vector((0, 0, 0.03))
            vmap = {v: leaves.verts.new(v.co) for v in lb.verts}
            for f in lb.faces:
                leaves.faces.new([vmap[v] for v in f.verts])
            lb.free()
        curl = [end + Vector((math.cos(a + u) * 0.16, math.sin(a + u) * 0.16, 0.06 * u)) for u in (0.0, 1.2, 2.4, 3.6)]
        M.tube_bm(bm, curl, 0.045, 5)
    vines = M.new_object("SwellingGourd_vines", bm, coll)
    M.set_materials(vines, ["GourdStem"])
    leaf = M.new_object("SwellingGourd_leaves", leaves, coll)
    M.set_materials(leaf, ["Leaf"])
    return vines, leaf


def build(coll):
    body = M.carved_pumpkin("SwellingGourd", "swelling-gourd", coll, RADIUS, HEIGHT, 12, "fang", 40, 22,
                            M.PALETTE_DEEP, shell=0.07, glow_r=0.5, face_scale=(1.0, 0.7))
    seams = build_seams(coll)
    vines, leaves = build_vines(coll)
    M.color_flat(seams, lambda mn, co, vi: (1.0, 0.58, 0.16))
    M.color_flat(vines, lambda mn, co, vi: M.mix((0.2, 0.26, 0.08), (0.36, 0.3, 0.14), 0.5 + 0.5 * math.sin(co.x * 3)))
    M.color_flat(leaves, lambda mn, co, vi: (0.78, 0.3, 0.05) if M.h01("lc", vi // 21) > 0.5 else (0.62, 0.42, 0.08))
    # the body (and its stem) ride Body; the vines and leaves ride Root
    for obj, bone in ((body, "Body"), (seams, "Body"), (vines, "Root"), (leaves, "Root")):
        g = obj.vertex_groups.new(name=bone)
        g.add([v.index for v in obj.data.vertices], 1.0, "REPLACE")
    # stand it on the ground: lift so the base sits at z = 0
    for obj in (body, seams, vines, leaves):
        obj.location.z += HEIGHT * 0.5
    bpy.ops.object.select_all(action="DESELECT")
    for obj in (body, seams, vines, leaves):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    gourd = M.join([body, seams, vines, leaves], "SwellingGourd")
    # the face looks along -Y: the glTF export turns that into the game's +Z front
    return gourd


def build_armature():
    data = bpy.data.armatures.new("SwellingGourd")
    arm = bpy.data.objects.new("SwellingGourd", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    root = data.edit_bones.new("Root")
    root.head, root.tail = (0, 0, 0), (0, 0, 0.4)
    body = data.edit_bones.new("Body")
    body.head, body.tail = (0, 0, 0.15), (0, 0, HEIGHT)
    body.parent = root
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def key(arm, t, body_rot=(0, 0, 0), body_scale=(1, 1, 1), body_loc=(0, 0, 0)):
    f = 1 + t * FPS
    pb = arm.pose.bones["Body"]
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = Euler(tuple(math.radians(a) for a in body_rot), "XYZ").to_quaternion()
    pb.scale = body_scale
    pb.location = body_loc
    for path in ("rotation_quaternion", "scale", "location"):
        pb.keyframe_insert(path, frame=f)
    rb = arm.pose.bones["Root"]
    rb.rotation_quaternion = Quaternion()
    rb.keyframe_insert("rotation_quaternion", frame=f)


def clip(arm, name, keys):
    act = bpy.data.actions.new("SwellingGourd|" + name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for k in keys:
        key(arm, *k)
    act["duration"] = keys[-1][0]


def build_clips(arm):
    # Idle: a slow heave (in bone space Y runs up the gourd, X and Z across it)
    idle = []
    for i in range(9):
        t = 2.0 * i / 8
        ph = i / 8 * TAU
        s = 1.0 + 0.035 * math.sin(ph)
        idle.append((t, (2.5 * math.sin(ph + 0.5), 0, 2 * math.sin(ph * 2)), (s, 1.0 + 0.05 * math.sin(ph), s)))
    clip(arm, "Idle", idle)
    # Death: it splits and slumps flat into the stubble
    clip(arm, "Death", [
        (0.0, (0, 0, 0), (1, 1, 1)),
        (0.18, (6, 0, 4), (1.12, 0.86, 1.12)),
        (0.55, (-18, 0, 10), (1.3, 0.55, 1.25), (0, -0.25, 0)),
        (1.0, (-24, 0, 12), (1.38, 0.42, 1.32), (0, -0.38, 0)),
        (1.4, (-24, 0, 12), (1.38, 0.4, 1.32), (0, -0.4, 0)),
    ])
    arm.animation_data.action = bpy.data.actions["SwellingGourd|Idle"]


def tune_emission():
    for name, strength in (("GourdLitSkin", 0.05), ("GourdFlesh", 0.45), ("GourdInner", 0.7)):
        mat = bpy.data.materials.get(name)
        b = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if mat else None
        if b:
            b.inputs["Emission Strength"].default_value = strength


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else None
    blend = argv[argv.index("--blend") + 1] if "--blend" in argv else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    gourd = build(bpy.context.scene.collection)
    M.shade_smooth(gourd, 1.0)
    arm = build_armature()
    gourd.parent = arm
    mod = gourd.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    build_clips(arm)
    tune_emission()
    tris = sum(len(p.vertices) - 2 for p in gourd.data.polygons)
    print("GOURD_REPORT tris=%d verts=%d materials=%s" % (tris, len(gourd.data.vertices), ",".join(m.name for m in gourd.data.materials)))
    if out:
        arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.rotation_quaternion = Quaternion()
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
        bpy.ops.object.select_all(action="DESELECT")
        arm.select_set(True)
        gourd.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.export_scene.gltf(
            filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
            export_vertex_color="NAME", export_vertex_color_name="Col", export_all_vertex_colors=False,
            export_normals=True, export_texcoords=False, export_tangents=False, export_materials="EXPORT",
            export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
            export_anim_slide_to_zero=True, export_skins=True, export_def_bones=False, export_extras=True,
            export_cameras=False, export_lights=False,
        )
        arm.animation_data.action = bpy.data.actions["SwellingGourd|Idle"]
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=blend)


if __name__ == "__main__":
    main()
