# Deepglass warden wall, the modular curtain-wall piece in the cradle pylon's
# language: mottled grey stone, a dark chamfered socle, riveted brass straps,
# and a cyan rune conduit channelled through the panel. Kit-compatible with the
# kcas wall it replaces: 4 wide (X) x 4 tall (Z) x ~1.3 deep (Y), origin on the
# ground at the module's centre, tiles along X (pilasters and merlon gaps are
# half-width at the ends so two butted modules make one pier / one crenel).
#
# LOW POLY BY CONSTRUCTION. The wall run places this hundreds of times, so the
# shipped mesh is ONLY the big blocks (~170 tris). Every small read, rivets,
# dentils, chamfers, rune channels, the sigil, lives on a separate HI mesh
# that is baked down onto the LO shell with selected-to-active, then deleted.
#
# VARIANT (prepend `VARIANT = "pillar"` to the script): the pier module the
# wall run stands every Nth slot, the same wall with a square rune-capped
# pier through its middle. Same 4-unit envelope so one placement scale fits
# both.
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/carve/scripts/assets/deepglass/dg_lib.py").read())
    OUT_DIR = "/Users/troy/Documents/woc/carve/tmp/asset_src/deepglass"
    VARIANT = globals().get("VARIANT", "wall")
    reset_scene()
    studio_lights()

    W, D, HT = 4.0, 0.80, 4.0           # module width, body slab depth, total height
    RAIL = 1.04                          # pilaster / rail depth (the panel recess is RAIL-D)
    PW, PD = 1.30, 1.56                  # pier section (pillar variant)
    M_STONE, M_DARK, M_BRASS, M_RUNE = 0, 1, 2, 3
    mats = [
        mat_stone("dgw_stone", STONE, STONE_DARK, scale=3.2, bump=0.30),
        mat_stone("dgw_stone_dark", STONE_DARK, srgb(0x4a463f), scale=4.5, bump=0.38),
        mat_brass("dgw_brass", scale=5.0, patina=0.28),
        mat_rune("dgw_rune", RUNE_CYAN, 1.2),
    ]

    def build(bm, lo):
        """Build the module into `bm`. lo=True emits only the shipped blocks."""
        def slab(size, z0, z1, mat, x=0.0, y=0.0):
            box(bm, (size[0], size[1], z1 - z0), center=(x, y, (z0 + z1) * 0.5), mat=mat)

        def rivet(x, y, z, along_x=True):
            box(bm, (0.13, 0.06, 0.13) if along_x else (0.06, 0.13, 0.13), center=(x, y, z), mat=M_BRASS)

        def strap(z0, z1, half_depth, x0=-W / 2, x1=W / 2, rivets=4):
            slab((x1 - x0, half_depth * 2, 0), z0, z1, M_BRASS, x=(x0 + x1) * 0.5)
            zc = (z0 + z1) * 0.5
            for k in range(rivets):
                x = x0 + (x1 - x0) * (k + 0.5) / rivets
                for s in (-1, 1):
                    rivet(x, s * (half_depth + 0.025), zc)

        # ---- socle: dark stepped base ---------------------------------------
        slab((W, 1.34), 0.00, 0.30, M_DARK)
        if lo:
            slab((W, 1.18), 0.30, 0.62, M_DARK)
        else:
            slab((W, 1.18), 0.30, 0.50, M_DARK)
            strap(0.50, 0.62, 0.55)

        # ---- body slab + frame: pilasters and rails leave a sunken panel -----
        slab((W, D), 0.60, 3.05, M_STONE)
        slab((0.36, RAIL), 0.60, 3.05, M_STONE, x=-W / 2 + 0.18)
        slab((0.36, RAIL), 0.60, 3.05, M_STONE, x=W / 2 - 0.18)
        slab((W, RAIL), 0.60, 0.80, M_STONE)      # bottom rail
        slab((W, RAIL), 2.83, 3.05, M_STONE)      # top rail

        # ---- rune conduit: one channel through the panel, broken for the sigil
        if not lo:
            ZR = 1.92
            for s in (-1, 1):
                ys = s * (D / 2)
                for (x0, x1) in ((-1.50, -0.36), (0.36, 1.50)):
                    pts, radii = [], []
                    N = 7
                    for k in range(N):
                        u = k / (N - 1)
                        pts.append(Vector((x0 + (x1 - x0) * u, ys, ZR)))
                        radii.append(0.040 + 0.022 * math.sin(u * math.pi))
                    tube_along(bm, pts, 0.04, segs=6, mat=M_RUNE, radii=radii)
                rot = Matrix.Rotation(math.radians(45), 3, 'Y')
                box(bm, (0.30, 0.07, 0.30), center=(0.0, ys + 0.015, ZR), mat=M_RUNE, rot=rot)
                for x in (-W / 2 + 0.18, W / 2 - 0.18):
                    pts = [Vector((x, s * RAIL / 2, z)) for z in (1.28, 1.92, 2.56)]
                    tube_along(bm, pts, 0.032, segs=6, mat=M_RUNE, radii=[0.028, 0.040, 0.028])

        # ---- crown: brass strap, dentils under the cornice lip, parapet ------
        if lo:
            # the strap + dentil band as one block, the cornice as another
            slab((W, 1.20), 3.05, 3.30, M_STONE)
            slab((W, 1.30), 3.30, 3.48, M_STONE)
        else:
            strap(3.05, 3.17, 0.54)
            for k in range(11):
                x = -W / 2 + W * (k + 0.5) / 11
                for s in (-1, 1):
                    box(bm, (0.17, 0.12, 0.13), center=(x, s * 0.585, 3.235), mat=M_STONE)
            slab((W, 1.30), 3.30, 3.48, M_STONE)     # cornice
        slab((W, 0.70), 3.48, 3.56, M_STONE)         # parapet sill
        merlon_x = [-1.5, 1.5] if VARIANT == "pillar" else [-1.5, -0.5, 0.5, 1.5]
        for x in merlon_x:
            if lo:
                slab((0.60, 0.56), 3.54, 4.00, M_STONE, x=x)
            else:
                slab((0.56, 0.52), 3.54, 3.90, M_STONE, x=x)
                slab((0.64, 0.60), 3.89, 3.95, M_BRASS, x=x)
                slab((0.50, 0.46), 3.95, 4.00, M_BRASS, x=x)

        # ---- pier (pillar variant): a square column through the middle ------
        if VARIANT == "pillar":
            slab((PW + 0.34, PD + 0.34), 0.00, 0.36, M_DARK)
            slab((PW + 0.16, PD + 0.16), 0.36, 0.56, M_DARK)
            slab((PW, PD), 0.50, 3.22, M_STONE)
            if not lo:
                for (z0, z1) in ((0.58, 0.70), (2.98, 3.10)):
                    slab((PW + 0.10, PD + 0.10), z0, z1, M_BRASS)
                    zc = (z0 + z1) * 0.5
                    for s in (-1, 1):
                        for x in (-0.36, 0.0, 0.36):
                            rivet(x, s * (PD / 2 + 0.075), zc)
                        for y in (-0.42, 0.0, 0.42):
                            rivet(s * (PW / 2 + 0.075), y, zc, along_x=False)
                for s in (-1, 1):
                    pts = [Vector((0.0, s * PD / 2, z)) for z in (0.95, 1.92, 2.82)]
                    tube_along(bm, pts, 0.045, segs=6, mat=M_RUNE, radii=[0.036, 0.058, 0.036])
                    rot = Matrix.Rotation(math.radians(45), 3, 'Y')
                    box(bm, (0.26, 0.07, 0.26), center=(0.0, s * PD / 2 + 0.015, 1.92), mat=M_RUNE, rot=rot)
            # capital: flared cap, brass collar, rune seat lens at the top
            slab((PW + 0.22, PD + 0.22), 3.20, 3.40, M_STONE)
            slab((PW + 0.44, PD + 0.44), 3.40, 3.58, M_STONE)
            slab((PW + 0.30, PD + 0.30), 3.58, 3.70, M_BRASS)
            if lo:
                slab((PW - 0.10, PD - 0.10), 3.70, 3.98, M_DARK)
            else:
                slab((PW - 0.10, PD - 0.10), 3.70, 3.82, M_DARK)
                torus(bm, 0.36, 0.055, major=24, minor=6, mat=M_BRASS, center=(0, 0, 3.82))
                lathe(bm, [(0.0, 0.0), (0.30, 0.03), (0.34, 0.09), (0.28, 0.14), (0.0, 0.18)],
                      segs=20, mat=M_RUNE, origin=(0, 0, 3.80))

    tag = "wall" if VARIANT == "wall" else "wall_pillar"

    bm = bmesh.new(); build(bm, lo=False)
    hi = new_obj(tag + "_hi", bm, mats)
    bevel_obj(hi, width=0.022, segments=1, angle_deg=40)
    LOG.append(f"hi faces={len(hi.data.polygons)}")

    bm = bmesh.new(); build(bm, lo=True)
    lo_mat = bpy.data.materials.new(tag + "_lo_tmp"); lo_mat.use_nodes = True
    lo = new_obj(tag, bm, [lo_mat])
    tris = sum(len(p.vertices) - 2 for p in lo.data.polygons)
    LOG.append(f"lo faces={len(lo.data.polygons)} tris={tris} verts={len(lo.data.vertices)}")

    # ---- bake HI -> LO (selected to active) --------------------------------
    uv_project([lo], angle=60, island_margin=0.006)

    def s2a(image, bake_type, samples, extrusion=0.14, ray=0.6):
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = samples
        b = sc.render.bake
        b.use_selected_to_active = True
        b.use_cage = False
        b.cage_extrusion = extrusion
        b.max_ray_distance = ray
        b.margin = 12
        b.use_clear = True
        made = _target_nodes([lo], image)
        try:
            with bpy.context.temp_override(**ctx_override()):
                for o in bpy.data.objects:
                    o.select_set(False)
                hi.select_set(True)
                lo.select_set(True)
                bpy.context.view_layer.objects.active = lo
                bpy.ops.object.bake(type=bake_type)
        finally:
            _clear_targets(made)
            b.use_selected_to_active = False

    def s2a_value(image, get_socket, samples=8):
        """Bake a Principled input of the HI materials by routing it through
        Emission (the EMIT trick from dg_lib.bake_value, source-side)."""
        stash = []
        for slot in hi.material_slots:
            m = slot.material
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
            sock = get_socket(bsdf)
            em = nt.nodes.new('ShaderNodeEmission')
            em.inputs['Strength'].default_value = 1.0
            if sock.is_linked:
                nt.links.new(sock.links[0].from_socket, em.inputs['Color'])
            else:
                v = sock.default_value
                em.inputs['Color'].default_value = (v[0], v[1], v[2], 1) if hasattr(v, '__len__') else (v, v, v, 1)
            prev = out.inputs['Surface'].links[0].from_socket
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
            stash.append((nt, em, out, prev))
        try:
            s2a(image, 'EMIT', samples)
        finally:
            for nt, em, out, prev in stash:
                nt.nodes.remove(em)
                nt.links.new(prev, out.inputs['Surface'])

    SIZE_T = 2048
    base = _img(tag + "_base", SIZE_T)
    rough = _img(tag + "_rough", SIZE_T, is_data=True)
    metal = _img(tag + "_metal", SIZE_T, is_data=True)
    emis = _img(tag + "_emis", SIZE_T)
    norm = _img(tag + "_norm", SIZE_T, is_data=True, fill=(0.5, 0.5, 1.0, 1))
    ao = _img(tag + "_ao", SIZE_T, is_data=True, fill=(1, 1, 1, 1))
    s2a_value(base, lambda b: b.inputs['Base Color'], samples=10)
    s2a(ao, 'AO', 48)
    s2a(rough, 'ROUGHNESS', 8)
    s2a(norm, 'NORMAL', 8)
    s2a_value(metal, lambda b: b.inputs['Metallic'], samples=4)
    s2a(emis, 'EMIT', 8)
    multiply_ao(base, ao, 0.5)
    for im, nm, cs in ((base, 'base', 'sRGB'), (rough, 'rough', 'Non-Color'), (metal, 'metal', 'Non-Color'),
                       (emis, 'emis', 'sRGB'), (norm, 'norm', 'Non-Color')):
        save_img(im, f"{OUT_DIR}/{tag}_{nm}.png", cs)
    LOG.append("baked")
    imgs = dict(base=base, rough=rough, metal=metal, emis=emis, norm=norm)
    mat = baked_material(tag, imgs, emissive_strength=1.0)
    apply_baked([lo], mat)
    bpy.data.objects.remove(hi, do_unlink=True)
    export_glb([lo], OUT_DIR + f"/{tag}.glb")
    LOG.append("exported")

    render_preview(OUT_DIR + f"/{tag}_front.png", (0.0, -7.6, 2.6), (0, 0, 2.0), size=(1000, 800))
    render_preview(OUT_DIR + f"/{tag}_quarter.png", (5.4, -6.4, 4.2), (0, 0, 2.0), size=(1000, 800))
    dups = []
    for dx in (-W, W):
        d = lo.copy(); d.data = lo.data
        d.location = (dx, 0, 0)
        bpy.context.scene.collection.objects.link(d)
        dups.append(d)
    bpy.context.view_layer.update()
    render_preview(OUT_DIR + f"/{tag}_run.png", (7.0, -13.0, 5.0), (0, 0, 2.0), size=(1400, 700), fov=46)
    for d in dups:
        bpy.data.objects.remove(d, do_unlink=True)
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
