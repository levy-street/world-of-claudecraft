# Exports Eastbrook Vale's Realm Builder monument from the Blender sculpt.
#
# Run it through the BlenderMCP bridge against the .blend holding the Tripo
# sculpt (objects: main, lanterns, Plaque Front, Plaque Back), then feed the
# result to scripts/assets/build_assets.mjs with specs/realm_builder_monument.json.
#
# WHY THIS IS NOT A TOWN MICRO-BATCH ASSET. Every other Eastbrook civic prop
# ships as flat town-palette vertex colours and merges into one batch that picks
# a surface from a shared atlas. The monument tried that and the owner rejected
# it: the carved detail in the sculpt's baked albedo is the whole point of the
# statue, and no palette colour replaces it. So it keeps its texture, leaves the
# batch, and is drawn by src/render/realm_builder_monument_fx.ts as its own prop.
#
# COLOR_0 still earns its place. glTF multiplies
# baseColorFactor x baseColorTexture x COLOR_0, so a per-vertex tint paints the
# authored plaque (dark plate, gold frame) straight on top of the albedo, with
# no second UV set and no second image.

import bpy, bmesh, math, traceback
from mathutils import Vector

OUT = "/Users/troy/Documents/woc/plaque/tmp/asset_src/realm_builder/realm_builder_monument.glb"


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(hexv):
    r = ((hexv >> 16) & 255) / 255.0
    g = ((hexv >> 8) & 255) / 255.0
    b = (hexv & 255) / 255.0
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


# Vertex TINTS, not colours: each one multiplies the albedo underneath, so they
# can only ever darken or shift it. White leaves the sculpt exactly as baked.
PLAIN = (1.0, 1.0, 1.0, 1.0)
# Pulls the beige stone down to dark slate: the plate the name projects off has
# to read as a recess, and a projection needs something dark to read against.
PLATE_TINT = lin(0x5D646C)
# Warm gold: red held, green and blue pulled down. The plaque frame and the
# lantern ironwork.
GOLD_TINT = lin(0xFF9E38)
# The flame cores are untextured, so this one IS a colour rather than a tint.
FLAME = lin(0xFFDC77)

# The plinth's tier ledges sit at z 0.02/0.06/0.09/0.21/0.25 and its top disc
# (the largest upward face in the sculpt) at 0.29. Only the plaques are tinted
# now, so these bands are no longer needed to colour the stone; the plate/frame
# split below is by face AREA, because the six recessed plate faces are an order
# of magnitude larger than any face in the frame around them.
PLATE_AREA = 0.004
SHARP_ANGLE = math.radians(32.0)

# The two tools the builder is holding. They ship on their own primitive with
# the PLAIN albedo, exactly like the rest of the statue: an earlier pass baked a
# gold tint and a strong emissive into them and the owner rejected it on sight,
# because a blown-out emissive drowns the texture and both read as flat yellow
# slabs. The gold is a RUNTIME pulse over the real surface instead
# (src/render/realm_builder_monument_fx.ts), and the sparkle needs a primitive
# of its own to sample from.
#
# Both are separate shells in the sculpt, so they are picked by nearest island
# centroid rather than by a bounding box: the box around the hammer head also
# catches part of the hand gripping it. Centroids measured off the source mesh;
# the build asserts the match is close.
GOLD_PART_TARGETS = {
    "hammer-head": Vector((-0.180, 0.010, 0.866)),
    "tablet": Vector((0.205, -0.154, 0.635)),
}
GOLD_PART_TOLERANCE = 0.06

log = []
try:
    scene = bpy.context.scene

    # ---- clean any previous run --------------------------------------------
    SOURCE_NAMES = {"main", "lanterns", "Plaque Front", "Plaque Back"}
    for ob in list(bpy.data.objects):
        if ob.name in SOURCE_NAMES:
            continue
        if (
            ob.name.startswith("Socket_")
            or ob.name.startswith("RB_")
            or ob.name.startswith("RealmBuilderMonument")
            or ob.name.startswith("EastbrookRealmBuilderMonument")
        ):
            bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    coll = bpy.data.collections.get("RealmBuilderExport")
    if coll is None:
        coll = bpy.data.collections.new("RealmBuilderExport")
        scene.collection.children.link(coll)
    for ob in list(coll.objects):
        bpy.data.objects.remove(ob, do_unlink=True)

    # ---- materials ----------------------------------------------------------
    tripo_image = None
    for img in bpy.data.images:
        if img.name.startswith("tripo_image"):
            tripo_image = img
            break
    if tripo_image is None:
        raise RuntimeError("the sculpt's baked albedo is missing from the blend")

    def monument_material(name, emissive_rgb=None, textured=True):
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
                nt.nodes.remove(n)
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.name = "ColAttr"
        attr.layer_name = "Col"
        attr.location = (bsdf.location.x - 600, bsdf.location.y - 200)
        if textured:
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.name = "Albedo"
            tex.image = tripo_image
            tex.location = (bsdf.location.x - 900, bsdf.location.y + 200)
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            mix.location = (bsdf.location.x - 300, bsdf.location.y)
            nt.links.new(tex.outputs["Color"], mix.inputs[6])
            nt.links.new(attr.outputs["Color"], mix.inputs[7])
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        else:
            nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
        if emissive_rgb is None:
            bsdf.inputs["Metallic"].default_value = 0.04
            bsdf.inputs["Roughness"].default_value = 0.82
            bsdf.inputs["Emission Strength"].default_value = 0.0
        else:
            bsdf.inputs["Metallic"].default_value = 0.1
            bsdf.inputs["Roughness"].default_value = 0.35
            bsdf.inputs["Emission Color"].default_value = emissive_rgb
            bsdf.inputs["Emission Strength"].default_value = 1.0
        return m

    # Three materials, three draws, and each earns its own:
    #   Surface  the sculpt's albedo, tinted per vertex for the plaque
    #   Tools    the SAME albedo, untinted: its own primitive only so the
    #            runtime can pulse it and sparkle off it
    #   Flame    untextured flame cores (an icosphere has no meaningful UV)
    mat_surface = monument_material("MonumentSurface")
    mat_tools = monument_material("MonumentTools")
    mat_flame = monument_material("MonumentFlame", (1.0, 1.0, 1.0, 1.0), textured=False)

    # ---- which faces of `main` are the builder's tools ----------------------
    # Islands only separate after a weld: the sculpt's importer split vertices
    # at every UV and normal seam, so an unwelded walk finds one island per
    # triangle. The weld does not MOVE faces, so a rounded face centroid is a
    # stable key back into the original mesh.
    def centroid_key(centre):
        return (round(centre.x, 5), round(centre.y, 5), round(centre.z, 5))

    gold_face_keys = set()
    main_src = bpy.data.objects["main"]
    weld = bmesh.new()
    weld.from_mesh(main_src.data)
    weld.transform(main_src.matrix_world)
    bmesh.ops.remove_doubles(weld, verts=weld.verts, dist=1e-4)
    weld.verts.ensure_lookup_table()
    seen = set()
    island_verts = []
    for v in weld.verts:
        if v.index in seen:
            continue
        stack = [v]
        comp = []
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.link_edges:
                other = e.other_vert(cur)
                if other.index not in seen:
                    seen.add(other.index)
                    stack.append(other)
        island_verts.append(comp)
    island_of_vert = {}
    for i, comp in enumerate(island_verts):
        for v in comp:
            island_of_vert[v.index] = i
    centroids = []
    for comp in island_verts:
        acc = Vector((0, 0, 0))
        for v in comp:
            acc += v.co
        centroids.append(acc / len(comp))
    for part, target in GOLD_PART_TARGETS.items():
        best = min(range(len(centroids)), key=lambda i: (centroids[i] - target).length)
        offset = (centroids[best] - target).length
        if offset > GOLD_PART_TOLERANCE:
            raise RuntimeError(
                "%s island moved: nearest centroid %s is %.4f from %s"
                % (part, tuple(round(v, 4) for v in centroids[best]), offset, tuple(target))
            )
        count = 0
        for f in weld.faces:
            if island_of_vert.get(f.verts[0].index) == best:
                gold_face_keys.add(centroid_key(f.calc_center_median()))
                count += 1
        log.append(
            "gold part %s: island %d, %d faces, centroid offset %.4f"
            % (part, best, count, offset)
        )
    weld.free()

    # ---- merge --------------------------------------------------------------
    surface = bmesh.new()
    surface_col = surface.loops.layers.float_color.new("Col")
    surface_uv = surface.loops.layers.uv.new("UVMap")
    gold = bmesh.new()
    gold_col = gold.loops.layers.float_color.new("Col")
    gold_uv = gold.loops.layers.uv.new("UVMap")
    flame = bmesh.new()
    flame_col = flame.loops.layers.float_color.new("Col")

    def copy_face(target, target_col, target_uv, face, src_uv, tint, vmap):
        """Copy one source face into `target`, carrying its UVs and a tint."""
        for v in face.verts:
            if v.index not in vmap:
                vmap[v.index] = target.verts.new(v.co)
        target.verts.ensure_lookup_table()
        try:
            new_face = target.faces.new([vmap[v.index] for v in face.verts])
        except ValueError:
            return False
        for index, loop in enumerate(new_face.loops):
            loop[target_col] = tint
            if target_uv is not None and src_uv is not None:
                loop[target_uv].uv = face.loops[index][src_uv].uv
        return True

    for src_name in ("main", "lanterns", "Plaque Front", "Plaque Back"):
        src = bpy.data.objects[src_name]
        # FULL RESOLUTION. An earlier pass collapse-decimated the statue to 45
        # percent to sit inside the town's old triangle target, and it showed:
        # the beard and the face went to putty at the size a player reads them
        # from. The owner asked for the real sculpt.
        tmp = bmesh.new()
        tmp.from_mesh(src.data)
        tmp.transform(src.matrix_world)
        tmp.faces.ensure_lookup_table()
        src_uv = tmp.loops.layers.uv.active
        surface_map = {}
        gold_map = {}
        moved = 0
        for f in tmp.faces:
            centre = f.calc_center_median()
            if src_name == "main" and centroid_key(centre) in gold_face_keys:
                if copy_face(gold, gold_col, gold_uv, f, src_uv, PLAIN, gold_map):
                    moved += 1
                continue
            if src_name.startswith("Plaque"):
                tint = PLATE_TINT if f.calc_area() > PLATE_AREA else GOLD_TINT
            elif src_name == "lanterns":
                tint = GOLD_TINT
            else:
                tint = PLAIN
            copy_face(surface, surface_col, surface_uv, f, src_uv, tint, surface_map)
        tmp.free()
        log.append("merged %s%s" % (src_name, (" (%d tool faces)" % moved) if moved else ""))

    surface.verts.ensure_lookup_table()
    surface.faces.ensure_lookup_table()

    # ---- recentre -----------------------------------------------------------
    # X/Y onto the axis, Z onto the floor. eastbrook_town.ts placementMatrix
    # seats a template by its ORIGIN, so an off-axis origin leans the statue.
    xs = [v.co.x for v in surface.verts]
    ys = [v.co.y for v in surface.verts]
    zs = [v.co.z for v in surface.verts]
    dx = -(min(xs) + max(xs)) / 2.0
    dy = -(min(ys) + max(ys)) / 2.0
    dz = -min(zs)
    for mesh in (surface, gold):
        bmesh.ops.translate(mesh, verts=mesh.verts, vec=(dx, dy, dz))
    log.append("recentre dx=%.5f dy=%.5f dz=%.5f" % (dx, dy, dz))

    # ---- hard normals -------------------------------------------------------
    # The albedo carries the detail now, but smooth normals over a hard edge
    # still round off the plinth courses and the tool silhouettes.
    for mesh in (surface, gold):
        sharp = 0
        for e in mesh.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > SHARP_ANGLE:
                e.smooth = False
                sharp += 1
        for f in mesh.faces:
            f.smooth = True
        log.append("hard edges: %d of %d" % (sharp, len(mesh.edges)))

    # ---- lantern flame anchors ---------------------------------------------
    lant = bpy.data.objects["lanterns"]
    lbm = bmesh.new()
    lbm.from_mesh(lant.data)
    lbm.transform(lant.matrix_world)
    bmesh.ops.remove_doubles(lbm, verts=lbm.verts, dist=1e-4)
    lbm.verts.ensure_lookup_table()
    seen = set()
    islands = []
    for v in lbm.verts:
        if v.index in seen:
            continue
        stack = [v]
        comp = []
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        islands.append(comp)
    heads = []
    for comp in islands:
        top = max(v.co.z for v in comp)
        head = [v.co for v in comp if v.co.z > top - 0.055]
        heads.append(
            Vector(
                (
                    sum(p.x for p in head) / len(head) + dx,
                    sum(p.y for p in head) / len(head) + dy,
                    sum(p.z for p in head) / len(head) + dz,
                )
            )
        )
    lbm.free()
    heads.sort(key=lambda p: math.atan2(p.y, p.x))
    for i, h in enumerate(heads):
        log.append(
            "lantern %d head (%.4f, %.4f, %.4f) r=%.4f"
            % (i, h.x, h.y, h.z, math.hypot(h.x, h.y))
        )

    # ---- flame cores --------------------------------------------------------
    # Placed from heads that ALREADY carry the recentre offset, so they must not
    # be translated a second time.
    for h in heads:
        sub = bmesh.new()
        bmesh.ops.create_icosphere(sub, subdivisions=1, radius=0.016)
        bmesh.ops.scale(sub, verts=sub.verts, vec=(1.0, 1.0, 1.75))
        bmesh.ops.translate(sub, verts=sub.verts, vec=h)
        vmap = {}
        for v in sub.verts:
            vmap[v.index] = flame.verts.new(v.co)
        flame.verts.ensure_lookup_table()
        for f in sub.faces:
            try:
                nf = flame.faces.new([vmap[v.index] for v in f.verts])
            except ValueError:
                continue
            for loop in nf.loops:
                loop[flame_col] = FLAME
        sub.free()
    # Smooth: a flame core is round, and smooth shading also lets the export
    # dedup share the icospheres' vertices.
    for f in flame.faces:
        f.smooth = True

    # ---- objects ------------------------------------------------------------
    def finish(mesh_data_name, object_name, bm, material):
        me = bpy.data.meshes.new(mesh_data_name)
        bm.to_mesh(me)
        bm.free()
        # One COLOR_0 only: a stray second colour attribute ships four bytes a
        # vertex that nothing reads (three's GLTFLoader binds COLOR_0 alone).
        for attr in list(me.color_attributes):
            if attr.name != "Col":
                me.color_attributes.remove(attr)
        me.color_attributes.active_color_index = 0
        me.color_attributes.render_color_index = 0
        me.materials.append(material)
        ob = bpy.data.objects.new(object_name, me)
        coll.objects.link(ob)
        return ob, me

    ob_surface, me_surface = finish(
        "RB_SurfaceMesh", "RealmBuilderMonument_Surface", surface, mat_surface
    )
    ob_gold, me_gold = finish("RB_ToolsMesh", "RealmBuilderMonument_Tools", gold, mat_tools)
    ob_flame, me_flame = finish("RB_FlameMesh", "RealmBuilderMonument_Flame", flame, mat_flame)

    # ---- plate anchors ------------------------------------------------------
    sockets = [("Socket_CivicCenter", Vector((0, 0, 0)), None, "center", "civic center alignment")]
    for src_name, key in (("Plaque Front", "Front"), ("Plaque Back", "Back")):
        src = bpy.data.objects[src_name]
        mw = src.matrix_world
        plate = [p for p in src.data.polygons if p.area > PLATE_AREA]
        total = sum(p.area for p in plate)
        ctr = Vector((0, 0, 0))
        nrm = Vector((0, 0, 0))
        for p in plate:
            ctr += (mw @ p.center) * p.area
            nrm += (mw.to_3x3() @ p.normal) * p.area
        ctr /= total
        nrm.normalize()
        ctr += Vector((dx, dy, dz))
        sockets.append(
            (
                "Socket_Plaque%s" % key,
                ctr,
                nrm,
                "plaque-%s" % key.lower(),
                "%s honour plate: hologram projection origin" % key.lower(),
            )
        )
        log.append(
            "plate %s ctr=(%.4f,%.4f,%.4f) n=(%.4f,%.4f,%.4f) faces=%d"
            % (key, ctr.x, ctr.y, ctr.z, nrm.x, nrm.y, nrm.z, len(plate))
        )
    for i, h in enumerate(heads):
        sockets.append(
            (
                "Socket_Lantern%d" % (i + 1),
                h,
                None,
                "lantern-%d" % (i + 1),
                "lantern flame: light and ember anchor",
            )
        )

    for name, pos, nrm, sid, purpose in sockets:
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.05
        e.location = pos
        if nrm is not None:
            e.rotation_mode = "QUATERNION"
            e.rotation_quaternion = nrm.to_track_quat("Z", "Y")
        # build_assets.mjs runs prune(), which drops any leaf node without
        # extras: the town's sculptSocket stamp is what keeps an anchor alive
        # through the pipeline.
        e["sculptSocket"] = {"id": sid, "purpose": purpose, "interactive": False}
        coll.objects.link(e)

    root = bpy.data.objects.new("EastbrookRealmBuilderMonument", None)
    coll.objects.link(root)
    for ob in list(coll.objects):
        if ob is not root:
            ob.parent = root

    for label, me in (("surface", me_surface), ("tools", me_gold), ("flame", me_flame)):
        log.append(
            "%s tris=%d verts=%d uv=%s"
            % (
                label,
                sum(len(p.vertices) - 2 for p in me.polygons),
                len(me.vertices),
                [layer.name for layer in me.uv_layers],
            )
        )
    bb = [Vector(c) for c in ob_surface.bound_box]
    log.append(
        "bbox X %.4f..%.4f Y %.4f..%.4f Z %.4f..%.4f"
        % (
            min(v.x for v in bb),
            max(v.x for v in bb),
            min(v.y for v in bb),
            max(v.y for v in bb),
            min(v.z for v in bb),
            max(v.z for v in bb),
        )
    )
    log.append(
        "rmax=%.5f" % max(math.hypot(v.co.x, v.co.y) for v in me_surface.vertices)
    )

    # ---- export -------------------------------------------------------------
    win = bpy.context.window_manager.windows[0]
    screen = win.screen
    area = next(a for a in screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    for ob in bpy.data.objects:
        ob.select_set(False)
    for ob in coll.objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = ob_surface
    with bpy.context.temp_override(window=win, screen=screen, area=area, region=region):
        bpy.ops.export_scene.gltf(
            filepath=OUT,
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=True,
            export_vertex_color="NAME",
            export_vertex_color_name="Col",
            export_all_vertex_colors=False,
            export_normals=True,
            export_texcoords=True,
            export_animations=False,
            export_extras=True,
            export_cameras=False,
            export_lights=False,
        )
    log.append("exported " + OUT)
except Exception:
    log.append(traceback.format_exc())
print("\n".join(log))
