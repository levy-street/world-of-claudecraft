# Warden wharf kit showcase, driven over the BlenderMCP bridge in the Blender
# GUI: imports every wharf GLB once and instances the EAST harbour of a laid-out
# map (scripts/assets/deepglass/wharf_layout.py output) at its exact map transforms, with
# the quay, the sea and a sun, then renders a hero shot and saves the .blend.
#
#   python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/bl_wharf_showcase.py
# Prepend MAP='<abs map.json>' / OUT='<abs dir>' lines to override the defaults.
# Game (x, y, z) -> Blender (x, -z, y); a placement's rotY is a Blender Z turn.
import json
import math
import os
import traceback

import bpy
from mathutils import Vector

LOG = []
try:
    # Repo root: a prepended REPO_ROOT, else WOC_REPO, else from __file__ (absent under a text-block or bridge exec).
    REPO_ROOT = globals().get('REPO_ROOT') or os.environ.get('WOC_REPO') or os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(globals()['__file__'])), '..', '..', '..'))
    ROOT = REPO_ROOT
    SRC = ROOT + "/tmp/asset_src/deepglass"
    MAP = globals().get("MAP", SRC + "/../../tidehold_final.map.json")
    OUT = globals().get("OUT", SRC)
    C = 2.325                                   # the east harbour's bearing
    CZ = 495.0

    def pol(r, phi):
        return (math.sin(phi) * r, CZ + math.cos(phi) * r)

    ox, oz = pol(305.0, C)                      # scene origin: mid harbour

    def ctx():
        win = bpy.context.window_manager.windows[0]
        area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
        region = next(r for r in area.regions if r.type == 'WINDOW')
        return dict(window=win, screen=win.screen, area=area, region=region)

    # fresh scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    sc = bpy.context.scene
    kit = bpy.data.collections.new("wharf_kit_sources")
    sc.collection.children.link(kit)
    harbour = bpy.data.collections.new("tidewharf_harbour")
    sc.collection.children.link(harbour)

    doc = json.load(open(MAP))
    pieces = []
    for p in doc["placements"]:
        a = p["assetId"]
        if not a.startswith("deepglass/wharf_"):
            continue
        r = math.hypot(p["x"], p["z"] - CZ)
        phi = math.atan2(p["x"], p["z"] - CZ)
        if abs(phi - C) < 0.45 and r > 250:
            pieces.append(p)
    tags = sorted({p["assetId"].split("/")[1] for p in pieces})
    meshes = {}
    for tag in tags:
        before = set(bpy.data.objects)
        with bpy.context.temp_override(**ctx()):
            bpy.ops.import_scene.gltf(filepath=f"{SRC}/{tag}.glb")
        new = [o for o in bpy.data.objects if o not in before]
        mesh_obs = [o for o in new if o.type == 'MESH']
        src = mesh_obs[0]
        src.name = tag
        for o in new:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            kit.objects.link(o)
        meshes[tag] = src.data
    kit.hide_viewport = True
    kit.hide_render = True
    for i, p in enumerate(pieces):
        tag = p["assetId"].split("/")[1]
        ob = bpy.data.objects.new(f"{tag}.{i:03d}", meshes[tag])
        ob.location = (p["x"] - ox, -(p["z"] - oz), p.get("groundY", 6.08) + p.get("y", 0.0))
        ob.rotation_euler = (0.0, 0.0, p["rotY"])
        # the layout grows pile-borne pieces in plan only (scaleX/Z); glTF Z
        # is Blender -Y, glTF Y (up) is Blender Z
        s = p.get("scale", 1.0)
        ob.scale = (s * p.get("scaleX", 1.0), s * p.get("scaleZ", 1.0), s * p.get("scaleY", 1.0))
        harbour.objects.link(ob)
    LOG.append(f"instanced {len(pieces)} wharf pieces from {len(tags)} kit meshes")

    # context: the quay (the Low Wards tier, flat at 6 to r 279.5) and the sea
    def flat(name, rgb, rough=0.8):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (*rgb, 1)
        b.inputs["Roughness"].default_value = rough
        return m
    bpy.ops.mesh.primitive_cylinder_add(vertices=256, radius=279.5, depth=46.0,
                                        location=(0 - ox, -(CZ - oz), 6.0 - 23.0))
    quay = bpy.context.active_object
    quay.name = "quay_low_wards"
    quay.data.materials.append(flat("cobble", (0.33, 0.30, 0.28), 0.9))
    bpy.ops.mesh.primitive_plane_add(size=900, location=(0, 0, -2.0))
    sea = bpy.context.active_object
    sea.name = "harbour_water"
    sm = flat("sea", (0.02, 0.18, 0.2), 0.05)
    sm.node_tree.nodes.get("Principled BSDF").inputs["Alpha"].default_value = 0.8
    sea.data.materials.append(sm)
    for o in (quay, sea):
        for c in list(o.users_collection):
            c.objects.unlink(o)
        harbour.objects.link(o)

    # light + world + camera: a warm late-afternoon sun off the sea
    sd = bpy.data.lights.new("sun", 'SUN')
    sd.energy = 3.5
    sd.angle = math.radians(3)
    sun = bpy.data.objects.new("sun", sd)
    sun.rotation_euler = (math.radians(52), math.radians(8), math.radians(160))
    sc.collection.objects.link(sun)
    world = sc.world or bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.45, 0.6, 0.72, 1)
    bg.inputs["Strength"].default_value = 0.9
    cd = bpy.data.cameras.new("hero")
    cd.lens = 28
    cd.clip_end = 4000
    cam = bpy.data.objects.new("hero", cd)
    sc.collection.objects.link(cam)
    # from out at sea, looking back at the harbour and the city behind it
    out_dir = Vector((math.sin(C), -math.cos(C), 0.0))
    cam.location = out_dir * 105 + Vector((-28, -12, 46))
    look = Vector((0, 0, 4)) - out_dir * 10
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = OUT + "/wharf_showcase_hero.png"
    with bpy.context.temp_override(**ctx()):
        bpy.ops.render.render(write_still=True)
    LOG.append("rendered " + sc.render.filepath)
    bpy.ops.wm.save_as_mainfile(filepath=OUT + "/wharf_showcase.blend", copy=True)
    LOG.append("saved " + OUT + "/wharf_showcase.blend")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(LOG))
result = "\n".join(LOG)
