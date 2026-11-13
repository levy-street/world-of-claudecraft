# Builds the Eastbrook houses: prepares the paint, assembles each house from the kit, writes
# one GLB per house under public/models/eastbrook_houses/, a collision table and preview
# renders. Headless, and it never touches a Blender you already have open:
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/eastbrook_houses/build.py
#
# Add `-- --only merchant_house` to build one house, `-- --no-preview` to skip the renders.
import json
import math
import os
import struct
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import houses  # noqa: E402
import kit  # noqa: E402
import lots  # noqa: E402
import paint  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "public", "models", "eastbrook_houses")
# The town's own lots replace the painted town models, so they live where the town code looks
# for painted buildings, one folder per colour set.
LOT_OUT = os.path.join(ROOT, "public", "models", "tidehold", "harbour")
# The colour sets a lot is shipped in: the same model with its roof, timber and stone
# repainted (paint.recolour turns the hue and keeps the brushwork), one folder each, so every
# town keeps a colour of its own. Each set: the textures it repaints as (hue turn in degrees,
# colour strength, brightness), the tones its surfaces are shipped at, and the lots it is built for
# (the models each painted look of the game stands, src/sim/painted_towns/models.ts).
COLOUR_SETS = {
    # marsh towns: mossy green slate, weathered timber
    "moss": ({"slate": (88.0, 0.8, 1.0), "timber": (0.0, 0.8, 0.9)}, {"eh_slate": (0.5, 0.56, 0.5), "eh_stone": (0.8, 0.86, 0.78)}, ("hall", "house_a", "shop_a", "shop_b", "tavern")),
    # the peaks: pale steel slate, dark timber, pale granite. The stone's tone leans warm on
    # purpose: a wall in shade is lit by the blue sky fill alone, and a pale stone with a cool
    # tone came out cobalt there (all of Highwatch read as a blue town). The warm tone lands
    # it on grey in shade and a sunny granite in the light. (retone.mjs wrote it into the
    # shipped files; this row keeps the next build in step.)
    "alpine": ({"slate": (14.0, 0.5, 1.3), "timber": (0.0, 0.85, 0.8), "stone": (0.0, 0.45, 1.22)}, {"eh_slate": (0.62, 0.66, 0.74), "eh_stone": (1.08, 0.98, 0.84)}, ("bank", "hall", "house_c", "shop_a", "smithy", "tavern_b", "guild")),
    # terracotta pantiles
    "pantile": ({"slate": (-150.0, 0.5, 1.0, (0.8, 0.4, 0.24))}, {"eh_slate": (0.8, 0.8, 0.8), "eh_stone": (0.94, 0.88, 0.78)}, ("house_a", "shop_a", "tavern")),
    # wooden shakes: weathered brown roofs
    "shakes": ({"slate": (-150.0, 0.18, 1.0, (0.54, 0.36, 0.23)), "timber": (0.0, 0.85, 0.92)}, {"eh_slate": (0.8, 0.8, 0.8)}, ("hall", "house_a", "tavern")),
    # plum slate
    "diamond": ({"slate": (-42.0, 0.9, 1.05)}, {"eh_slate": (0.5, 0.44, 0.54)}, ("hall", "house_c", "shop_a", "smithy", "tavern")),
    # oxblood tile over warm brick-coloured stone
    "brick": ({"slate": (-150.0, 0.4, 1.0, (0.56, 0.2, 0.16))}, {"eh_slate": (0.82, 0.82, 0.82), "eh_stone": (0.98, 0.8, 0.68)}, ("hall", "house_a", "shop_a", "smithy", "tavern")),
    # straw thatch colour
    "thatch": ({"slate": (-150.0, 0.15, 1.0, (0.9, 0.66, 0.28))}, {"eh_slate": (0.82, 0.82, 0.82), "eh_stone": (0.92, 0.88, 0.8)}, ("hall", "house_a", "house_b", "smithy", "tavern")),
}
TMP = os.path.join(ROOT, "tmp", "eastbrook_houses")
ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ONLY = ARGS[ARGS.index("--only") + 1] if "--only" in ARGS else None
PREVIEW = "--no-preview" not in ARGS
# `--sets` also writes every colour set of each lot built
SETS = "--sets" in ARGS
# `--collision-only` rebuilds each lot in memory and rewrites its collision table alone: no
# model file, preview or report is touched (for a change to what is solid, not to what is seen)
COLLISION_ONLY = "--collision-only" in ARGS
# The placement loader normalises a model so its largest dimension is this many units.
NORMALISED = 2.2
# How the shipped materials differ from Blender's plain export.
GLASS_BASE = 0.42
GLASS_GLOW = 0.8
# The game's daylight is bright: each surface is toned down to keep its painted colour
# (deep oxblood timber, indigo slate) instead of washing out.
TONE = {
    "eh_stone": (0.86, 0.86, 0.86),
    "eh_timber": (0.74, 0.74, 0.74),
    "eh_trim": (0.76, 0.76, 0.76),
    # slate takes the full sky: darker and a touch bluer, or it bleaches to lilac at noon
    "eh_slate": (0.4, 0.45, 0.58),
    "eh_hull": (0.72, 0.72, 0.72),
    "eh_parts": (0.8, 0.8, 0.8),
    "eh_parts_solid": (0.8, 0.8, 0.8),
}


def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def export(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
        obj.data.color_attributes.active_color = obj.data.color_attributes["Color"]
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="WEBP",
        export_image_quality=90,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        export_extras=False,
    )


def patch_glb(path, tone=None):
    """Sets what Blender's exporter cannot be trusted with: the atlas cut-out mode, which
    surfaces are two-sided, and the glass glowing from its own painting."""
    with open(path, "rb") as f:
        data = f.read()
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20 : 20 + json_len])
    rest = data[20 + json_len :]
    for mat in doc.get("materials", []):
        name = mat.get("name", "")
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 0.92
        mat.pop("alphaCutoff", None)
        mat["alphaMode"] = "OPAQUE"
        mat["doubleSided"] = False
        if name in TONE:
            pbr["baseColorFactor"] = [*(tone or {}).get(name, TONE[name]), 1.0]
        if name == "eh_parts":
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = 0.5
            mat["doubleSided"] = True
        elif name == "eh_parts_solid":
            mat["doubleSided"] = True
        elif name in ("eh_glass", "eh_stained", "eh_parts_glow"):
            mat["doubleSided"] = name == "eh_parts_glow"
            # (the chapel's stained glass was also tried at a deeper tone and a lower glow: it
            # looked no better, so it glows like the house glass)
            pbr["baseColorFactor"] = [GLASS_BASE, GLASS_BASE, GLASS_BASE, 1.0]
            mat["emissiveTexture"] = dict(pbr["baseColorTexture"])
            mat["emissiveFactor"] = [GLASS_GLOW, GLASS_GLOW, GLASS_GLOW]
            mat.get("extensions", {}).pop("KHR_materials_emissive_strength", None)
            if not mat.get("extensions"):
                mat.pop("extensions", None)
    body = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    body += b" " * ((4 - len(body) % 4) % 4)
    total = 12 + 8 + len(body) + len(rest)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(body), 0x4E4F534A))
        f.write(body)
        f.write(rest)
    return doc


def bounds(objects):
    xs = [v.co.x for obj in objects for v in obj.data.vertices]
    ys = [v.co.y for obj in objects for v in obj.data.vertices]
    zs = [v.co.z for obj in objects for v in obj.data.vertices]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def lot_rows(made, max_dim):
    """A lot's collision rows (yards in the model's axes) in the loader's normalised space."""
    k = NORMALISED / max_dim
    boxes = [{key: round(value * k, 4) for key, value in box.items()} for box in made["boxes"]]
    ramps = [{key: (round(value, 4) if key == "ry" else round(value * k, 4)) for key, value in ramp.items()} for ramp in made["ramps"]]
    return {"mode": "baked", "boxes": boxes, "ramps": ramps}


def collision(house_boxes, lo, hi):
    """The kit's boxes (yards, Z up, origin at the floor centre) in the placement loader's
    normalised model space (Y up, largest dimension = 2.2, the GLB's -Y becoming +Z)."""
    max_dim = max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    k = NORMALISED / max_dim
    out = []
    if not house_boxes:
        # a prop that declares no walls collides on its own bounds
        house_boxes = [((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2, (hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2)]
    for cx, cy, cz, hx, hy, hz in house_boxes:
        out.append({"x": round(cx * k, 4), "y": round((cz - lo[2]) * k, 4), "z": round(-cy * k, 4), "hx": round(hx * k, 4), "hy": round(hz * k, 4), "hz": round(hy * k, 4)})
    return out, max_dim


def shade_for_preview(materials):
    """The game multiplies each surface by its vertex colour; wire the same into Blender's
    materials so a preview render shows the painted shade."""
    for mat in materials.values():
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
        image = next(n for n in nodes if n.type == "TEX_IMAGE")
        attribute = nodes.new("ShaderNodeVertexColor")
        attribute.layer_name = "Color"
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        links.new(image.outputs["Color"], mix.inputs[6])
        links.new(attribute.outputs["Color"], mix.inputs[7])
        links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        mat.use_backface_culling = mat.name not in ("eh_parts", "eh_parts_solid", "eh_parts_glow")


def preview(objects, name, lo, hi, only=None):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    if bpy.data.objects.get("camera") is None:
        preview_rig(scene)
    camera = bpy.data.objects["camera"]
    height = hi[2]
    size = max(hi[0] - lo[0], hi[1] - lo[1], height)
    centre = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0.0))
    os.makedirs(os.path.join(TMP, "preview"), exist_ok=True)
    # tag, bearing of the camera from the house (degrees, -90 = straight in front), distance
    # as a multiple of the house's size, camera height, height looked at, lens
    shots = (
        ("street", -112.0, 1.25, 1.9, height * 0.42, 26),
        ("hero", -58.0, 1.7, height * 0.5, height * 0.45, 36),
        ("back", 122.0, 1.7, height * 0.55, height * 0.45, 36),
        ("door", -100.0, 0.55, 1.9, height * 0.22, 24),
    )
    for tag, bearing, distance, cam_z, look_z, lens in shots:
        if only and tag not in only:
            continue
        a = math.radians(bearing)
        camera.data.lens = lens
        camera.location = centre + Vector((math.cos(a) * size * distance, math.sin(a) * size * distance, cam_z))
        direction = centre + Vector((0.0, 0.0, look_z)) - camera.location
        camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(TMP, "preview", f"{name}_{tag}.png")
        bpy.ops.render.render(write_still=True)


def preview_rig(scene):
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    background.inputs["Color"].default_value = (0.42, 0.62, 0.92, 1.0)
    background.inputs["Strength"].default_value = 1.0
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.4
    sun.data.angle = math.radians(3.0)
    sun.rotation_euler = (math.radians(54), 0.0, math.radians(-34))
    scene.collection.objects.link(sun)
    ground = bpy.data.meshes.new("ground")
    ground.from_pydata([(-90, -90, 0), (90, -90, 0), (90, 90, 0), (-90, 90, 0)], [], [(0, 1, 2, 3)])
    ground_obj = bpy.data.objects.new("ground", ground)
    ground_mat = bpy.data.materials.new("ground")
    ground_mat.use_nodes = True
    next(n for n in ground_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.16, 0.3, 0.09, 1.0)
    ground.materials.append(ground_mat)
    scene.collection.objects.link(ground_obj)
    camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    scene.collection.objects.link(camera)
    scene.camera = camera


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(LOT_OUT, exist_ok=True)
    os.makedirs(os.path.join(TMP, "collision"), exist_ok=True)
    os.makedirs(os.path.join(TMP, "lot_collision"), exist_ok=True)
    paths, parts, bands = paint.prepare(os.path.join(TMP, "painted"))
    kit.PARTS, kit.BANDS = parts, bands
    report = {}
    lot_report = {}
    jobs = [(name, make, False) for name, make in houses.HOUSES.items()] + [(name, make, True) for name, make in lots.LOTS.items()]
    for name, make, is_lot in jobs:
        if ONLY and name != ONLY and not (ONLY == "lots" and is_lot):
            continue
        fresh_scene()
        # the town's own lots carry exactly one yard of footing and face the other way
        kit.FOOTING = 1.0 if is_lot else 3.0
        made = make()
        house, lot_made = made if is_lot else (made, None)
        if lot_made:
            lots.furnish(lot_made, house)
        used = list(house.materials)
        materials = {key: kit.make_material(key, paths) for key in used}
        boxes = list(house.boxes)
        objects = house.finish(materials, turn=is_lot)
        lo, hi = bounds(objects)
        target = os.path.join(LOT_OUT if is_lot else OUT, f"{name}.glb")
        max_dim = max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
        if COLLISION_ONLY:
            if is_lot and lot_made:
                with open(os.path.join(TMP, "lot_collision", f"{name}.json"), "w") as f:
                    json.dump(lot_rows(lot_made, max_dim), f, indent=1)
                print("COLLISION", name, len(lot_made["boxes"]), "boxes", len(lot_made["ramps"]), "ramps", "max_dim", round(max_dim, 4))
            continue
        export(objects, target)
        doc = patch_glb(target)
        if is_lot:
            table = lot_rows(lot_made, max_dim) if lot_made else None
            lot_report[name] = {
                "max_dim": round(max_dim, 4),
                "height": round(hi[2] - lo[2], 4),
                # the whole model in the record's axes (x = -kit x, z = kit y)
                "reach": {"x": round(-(lo[0] + hi[0]) / 2, 4), "z": round((lo[1] + hi[1]) / 2, 4), "width": round(hi[0] - lo[0], 4), "depth": round(hi[1] - lo[1], 4)},
                "air": lot_made.get("air") if lot_made else None,
            }
        else:
            table, max_dim = collision(boxes, lo, hi)
            table = {"mode": "baked", "boxes": table}
        if table:
            with open(os.path.join(TMP, "lot_collision" if is_lot else "collision", f"{name}.json"), "w") as f:
                json.dump(table, f, indent=1)
        report[name] = {
            "triangles": sum(len(p.vertices) - 2 for obj in objects for p in obj.data.polygons),
            "objects": [obj.name for obj in objects],
            "size_yards": [round(hi[i] - lo[i], 2) for i in range(3)],
            "min_z": round(lo[2], 2),
            "max_dim": round(max_dim, 3),
            "placement_scale": round(max_dim / NORMALISED, 4),
            "bytes": os.path.getsize(target),
            "materials": [m["name"] + ":" + m["alphaMode"] for m in doc["materials"]],
            "boxes": len(table["boxes"]) if table else 0,
            "footing": round(-lo[2], 3),
        }
        print("BUILT", name, json.dumps({k: report[name][k] for k in ("triangles", "objects", "size_yards", "min_z", "max_dim", "bytes")}))
        def swap(fresh):
            """Points every material at a colour set's paintings; returns how to undo it."""
            swapped = []
            for key, mat in materials.items():
                image_key = {"parts_solid": "parts", "parts_glow": "parts"}.get(key, key)
                if fresh[image_key] == paths[image_key]:
                    continue
                node = next(n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE")
                swapped.append((node, node.image))
                node.image = bpy.data.images.load(fresh[image_key], check_existing=True)
            return swapped

        sets = []
        if is_lot and SETS:
            for label, (changes, tones, wanted) in COLOUR_SETS.items():
                if name not in wanted:
                    continue
                fresh = paint.colourway(os.path.join(TMP, "painted", label), paths, changes)
                swapped = swap(fresh)
                folder = LOT_OUT + "_" + label
                os.makedirs(folder, exist_ok=True)
                export(objects, os.path.join(folder, f"{name}.glb"))
                patch_glb(os.path.join(folder, f"{name}.glb"), tones)
                for node, image in swapped:
                    node.image = image
                sets.append((label, fresh))
        if PREVIEW:
            shade_for_preview(materials)
            preview(objects, name, lo, hi)
            for label, fresh in sets:
                swapped = swap(fresh)
                preview(objects, f"{name}__{label}", lo, hi, only=("back",))
                for node, image in swapped:
                    node.image = image
    kit.FOOTING = 3.0
    if COLLISION_ONLY:
        return
    merged = {}
    report_path = os.path.join(TMP, "report.json")
    if os.path.exists(report_path):
        merged = json.load(open(report_path))
    merged.update(report)
    with open(report_path, "w") as f:
        json.dump(merged, f, indent=1)
    lots_path = os.path.join(TMP, "lots.json")
    lots_merged = json.load(open(lots_path)) if os.path.exists(lots_path) else {}
    lots_merged.update(lot_report)
    with open(lots_path, "w") as f:
        json.dump(lots_merged, f, indent=1)


if __name__ == "__main__":
    main()
