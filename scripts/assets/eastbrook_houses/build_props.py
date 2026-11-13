# Builds the harbour props (props.py) and writes each one OVER the release model it replaces,
# fitted to that model's bounds (tmp/eastbrook_houses/old_props.json, written by
# measure_old.mjs from git HEAD), so every size rule and collider the game keeps for a prop
# still holds and every town, camp and quay that stands the prop shows the new one.
#
#   node scripts/assets/eastbrook_houses/measure_old.mjs
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/eastbrook_houses/build_props.py
#
# Add `-- --only props/well` for one prop (or a comma-separated list, a trailing * matching
# a prefix), `-- --no-preview` to skip the preview pictures.
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build  # noqa: E402
import kit  # noqa: E402
import paint  # noqa: E402
import props  # noqa: E402

ROOT = build.ROOT
TMP = build.TMP
ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
# The dressed stone's colour: a pale cool grey, the castles' own (render/castle_stone.ts
# draws their code-built masses in a coursed grey ashlar, and these pieces bolt onto them).
ASHLAR_DYE = (0.74, 0.77, 0.8)
ONLY = ARGS[ARGS.index("--only") + 1] if "--only" in ARGS else None
# `--out <folder>` writes the props there and leaves the shipped models alone: a look at a
# new piece (its file, its preview, its stretch) before it is stood in the game.
OUT = ARGS[ARGS.index("--out") + 1] if "--out" in ARGS else os.path.join(ROOT, "public", "models")
PREVIEW = "--no-preview" not in ARGS


def look_of(name):
    """A colour set by name: one of the towns' (build.py COLOUR_SETS) or one of the props'
    own (props_castle.py PROP_LOOKS). Returns (the sheets repainted, the surface tones)."""
    import props_castle

    if name in props_castle.PROP_LOOKS:
        return props_castle.PROP_LOOKS[name]
    changes, tones, _lots = build.COLOUR_SETS[name]
    return changes, tones


def fit(objects, old, turn, exact, tall=None):
    """Turns the prop to the way its loader expects, then lays it on the old model's bounds:
    every axis when `exact`, one scale when it is "inside" (or the scale ("stretch", n)
    names), otherwise only its seat
    (centred, standing on the ground), grown or shrunk as one to `tall` yards high when
    that is given. A prop of several meshes moves as one."""
    if turn:
        for obj in objects:
            obj.data.transform(Matrix.Rotation(math.radians(turn), 4, "Z"))
    lo, hi = build.bounds(objects)
    size = [hi[i] - lo[i] for i in range(3)]
    centre = [(lo[i] + hi[i]) / 2 for i in range(3)]
    if exact:
        # the old bounds are glTF's (x, y up, z); Blender's y is glTF's -z
        want = (old["size"][0], old["size"][2], old["size"][1])
        scale = [want[i] / size[i] if size[i] > 1e-6 else 1.0 for i in range(3)]
        if exact == "inside":
            scale = [min(scale)] * 3
        elif isinstance(exact, tuple) and exact[0] == "stretch":
            # One scale, named outright: model units per yard of the design. For a building
            # that must stand at a person's scale whatever size the old model was drawn at
            # (the game draws a hex building at about seven times its file's size).
            scale = [exact[1]] * 3
        seat = (
            (old["min"][0] + old["max"][0]) / 2,
            -(old["min"][2] + old["max"][2]) / 2,
            old["min"][1],
        )
    else:
        scale = [tall / size[2] if tall and size[2] > 1e-6 else 1.0] * 3
        seat = (0.0, 0.0, 0.0)
    moves = (
        Matrix.Translation(Vector((-centre[0], -centre[1], -lo[2]))),
        Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0)),
        Matrix.Translation(Vector(seat)),
    )
    whole = Matrix.Identity(4)
    for move in moves:
        for obj in objects:
            obj.data.transform(move)
        whole = move @ whole
    if turn:
        whole = whole @ Matrix.Rotation(math.radians(turn), 4, "Z")
    return scale, whole


def rename_materials(path, names):
    """Gives painted surfaces the material names a loader looks for. The street lamp's pane
    and flame are authored at the brightness every lamp in the game shares, so the loader's
    one gain per role lights this one like the rest."""
    import struct

    with open(path, "rb") as f:
        data = f.read()
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20 : 20 + json_len])
    rest = data[20 + json_len :]
    # the lamp loader's own anchor carries its flag as well as its name, the way every lamp
    # in the game is authored (tests/streetlamp_asset_wave.test.ts reads both)
    for node in doc.get("nodes", []):
        if node.get("name") == "LIGHT_SOCKET":
            node.setdefault("extras", {})["woc_light_socket"] = True
    for mat in doc.get("materials", []):
        fresh = names.get(mat.get("name", ""))
        if not fresh:
            continue
        mat["name"] = fresh
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        # a fire (LAMP_FLAME, which the game makes lick and flicker) and a steady source are
        # authored alike: the name alone decides whether the runtime animates it
        if fresh in ("LAMP_SOURCE", "LAMP_FLAME"):
            pbr.pop("baseColorTexture", None)
            pbr["baseColorFactor"] = [1.0, 0.62, 0.24, 1.0]
            mat.pop("emissiveTexture", None)
            mat["emissiveFactor"] = [0.9, 0.38, 0.1]
        elif fresh == "LAMP_GLASS":
            pbr["baseColorFactor"] = [0.7, 0.7, 0.7, 1.0]
            # times the loader's glass gain of 2.4 this lands just under the bloom knee
            # (1.32), so a pane glows without washing out its housing
            mat["emissiveFactor"] = [0.54, 0.54, 0.54]
    body = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    body += b" " * ((4 - len(body) % 4) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(body) + len(rest)))
        f.write(struct.pack("<II", len(body), 0x4E4F534A))
        f.write(body)
        f.write(rest)


def snap(objects, name, hi):
    scene = bpy.context.scene
    if bpy.data.objects.get("camera") is None:
        try:
            scene.render.engine = "BLENDER_EEVEE"
        except TypeError:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
        scene.render.resolution_x = 480
        scene.render.resolution_y = 400
        scene.view_settings.view_transform = "Standard"
        build.preview_rig(scene)
    camera = bpy.data.objects["camera"]
    lo, top = build.bounds(objects)
    size = max(top[0] - lo[0], top[1] - lo[1], top[2] - lo[2])
    centre = Vector(((lo[0] + top[0]) / 2, (lo[1] + top[1]) / 2, (lo[2] + top[2]) / 2))
    a = math.radians(-62.0)
    camera.data.lens = 40
    camera.location = centre + Vector((math.cos(a) * size * 2.0, math.sin(a) * size * 2.0, size * 0.9))
    direction = centre - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    os.makedirs(os.path.join(TMP, "props_preview"), exist_ok=True)
    scene.render.filepath = os.path.join(TMP, "props_preview", name.replace("/", "__") + ".png")
    bpy.ops.render.render(write_still=True)


def export_prop(objects, extras, path):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
        obj.data.color_attributes.active_color = obj.data.color_attributes["Color"]
    for extra in extras:
        extra.select_set(True)
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
        # by NAME: the props' tints (iron, canvas, tar, water, an apple's red) are vertex
        # colours, and "ACTIVE" quietly writes none from a headless build
        export_vertex_color="NAME",
        export_vertex_color_name="Color",
        export_all_vertex_colors=False,
        export_extras=False,
    )


def main():
    old = json.load(open(os.path.join(TMP, "old_props.json")))
    paths, parts, bands = paint.prepare(os.path.join(TMP, "painted"))
    small = paint.downsized(os.path.join(TMP, "painted_props"), paths)
    # the castle's dressed stone: the house stone's colours relaid as level courses of long
    # pale blocks (paint.ashlar), so a curtain wall reads as masonry and not as rubble
    small["ashlar"] = os.path.join(TMP, "painted_props", "ashlar.png")
    paint.save(small["ashlar"], paint.ashlar(paint.load(small["stone"]), dye=ASHLAR_DYE)[..., :3])
    kit.PARTS, kit.BANDS = parts, bands
    kit.FOOTING = 0.3
    report = {}
    # A prop may ask for smaller maps still (`maps`: the tile's size in pixels, the parts
    # atlas at twice that): the small fixtures the game holds to a file budget (a street
    # lamp at 128 KB, the mailbox and the notice board at 100 KB) wear the same paintings
    # at a quarter of the props' usual size.
    map_sets = {512: small}

    def maps_for(size, look=None):
        key = (size, look) if look else size
        if key not in map_sets:
            sheets = paths
            folder = os.path.join(TMP, f"painted_props_{size}")
            if look:
                # one of the towns' colour sets (build.py COLOUR_SETS): its own roof, timber
                # and stone sheets, cut down like the rest
                sheets = paint.colourway(os.path.join(TMP, "painted", look), paths, look_of(look)[0])
                folder += "_" + look
            fresh = paint.downsized(folder, sheets, tile=size, atlas=size * 2)
            fresh["ashlar"] = os.path.join(folder, "ashlar.png")
            paint.save(fresh["ashlar"], paint.ashlar(paint.load(fresh["stone"]), dye=ASHLAR_DYE)[..., :3])
            map_sets[key] = fresh
        return map_sets[key]

    for target, spec in props.PROPS.items():
        if ONLY and not any(target == want or (want.endswith("*") and target.startswith(want[:-1])) for want in ONLY.split(",")):
            continue
        build.fresh_scene()
        model = spec["make"]()
        extras_models = getattr(model, "extras", [])
        names = list(model.materials) + [key for extra in extras_models for key in extra.materials if key not in model.materials]
        materials = {key: kit.make_material(key, maps_for(spec.get("maps", 512), spec.get("look"))) for key in names}
        objects = model.finish(materials)
        for index, piece in enumerate(objects):
            piece.name = target.split("/")[-1] + ("" if index == 0 else "_inside")
        # a part the game moves on its own (a windmill's sails) leaves as its own mesh, under
        # the name its loader looks for
        for extra in extras_models:
            piece = extra.finish(materials)[0]
            piece.name = piece.data.name = extra.name
            objects.append(piece)
        exact = spec.get("fit", True)
        measured = old[spec.get("like", target)]
        scale, whole = fit(objects, measured, spec.get("turn", 0.0), exact, spec.get("tall"))
        # the model's named points ride along as empties, moved exactly as the mesh was
        extras = []
        for socket, at in model.sockets.items():
            empty = bpy.data.objects.new(socket, None)
            empty.location = whole @ Vector(at)
            bpy.context.scene.collection.objects.link(empty)
            extras.append(empty)
        path = os.path.join(OUT, target + ".glb")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # the file first, from the clean materials; the preview's wiring comes after it
        export_prop(objects, extras, path)
        # The surface tones: the kit's own (build.py TONE), under a `look`'s (one of the colour
        # sets, a town's or a prop's own), under this one piece's own `tone` where it has one.
        tone = dict(look_of(spec["look"])[1]) if spec.get("look") else {}
        tone.update(spec.get("tone") or {})
        build.patch_glb(path, tone or None)
        if spec.get("rename"):
            rename_materials(path, spec["rename"])
        # a piece whose loader reads something the kit cannot author (a tag on a socket
        # node) finishes its own file once it is written
        if spec.get("post"):
            spec["post"](path)
        if PREVIEW:
            build.shade_for_preview(materials)
            snap(objects, target, None)
        lo, hi = build.bounds(objects)
        report[target] = {
            "triangles": sum(len(p.vertices) - 2 for piece in objects for p in piece.data.polygons),
            "bytes": os.path.getsize(path),
            "size": [round(hi[0] - lo[0], 3), round(hi[2] - lo[2], 3), round(hi[1] - lo[1], 3)],
            "old_size": measured["size"],
            "stretch": [round(v, 3) for v in scale],
            "materials": names,
        }
        print("PROP", target, json.dumps(report[target]))
    kit.FOOTING = 3.0
    out = os.path.join(TMP, "props_report.json")
    merged = json.load(open(out)) if os.path.exists(out) else {}
    merged.update(report)
    with open(out, "w") as f:
        json.dump(merged, f, indent=1)


if __name__ == "__main__":
    main()
