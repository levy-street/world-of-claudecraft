# Deepglass warden tower, the octagonal wall tower that stands at Tidehold's
# gate, ward corners and keep, in the cradle pylon's language: mottled stone
# over a dark chamfered socle, riveted brass straps, four cyan rune conduits
# on alternate facets, warm-lit arrow slits between them, a corbelled crown
# with dentils, a crenellated parapet with brass-capped merlons, and a rune
# lens set in the roof.
#
# Envelope: 8 tall (Z), ~4.1 across (X/Y), origin on the ground at centre, so
# the placement height argument IS the tower height (maxDim = height).
#
# LOW POLY BY CONSTRUCTION, like dg_wall.py: `build(bm, lo)` emits the big
# forms always and the small reads only for the HI mesh, which is baked onto
# the LO shell with selected-to-active and then deleted. LO is one 8-sided
# lathe plus eight merlon boxes.
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/carve/scripts/assets/deepglass/dg_lib.py").read())
    OUT_DIR = "/Users/troy/Documents/woc/carve/tmp/asset_src/deepglass"
    reset_scene()
    studio_lights()

    N = 8
    HT = 8.0
    M_STONE, M_DARK, M_BRASS, M_RUNE, M_WARM = 0, 1, 2, 3, 4
    mats = [
        mat_stone("dgt_stone", STONE, STONE_DARK, scale=2.4, bump=0.30),
        mat_stone("dgt_stone_dark", STONE_DARK, srgb(0x4a463f), scale=3.4, bump=0.38),
        mat_brass("dgt_brass", scale=4.0, patina=0.28),
        mat_rune("dgt_rune", RUNE_CYAN, 1.2),
        mat_rune("dgt_warm", RUNE_WARM, 0.8),
        mat_stone("dgt_wood", srgb(0x9a4a2c), srgb(0x5c2a16), scale=2.0, rough=(0.55, 0.85), bump=0.30),
    ]
    M_WOOD = 5
    # radii are CIRCUMradii; a facet's centre sits at the apothem
    AP = math.cos(math.pi / N)
    def facet(k):
        return math.pi / N + k * TAU / N

    # the tower's profile (r, z), one lathe for the whole stone body
    R_SOCLE0, R_SOCLE1 = 1.85, 1.72
    R_BODY0, R_BODY1 = 1.55, 1.42
    R_CORBEL, R_CORNICE, R_SILL = 1.90, 2.05, 1.85
    Z_BODY0, Z_BODY1 = 0.90, 6.20

    def body_r(z):
        t = (z - Z_BODY0) / (Z_BODY1 - Z_BODY0)
        return R_BODY0 + (R_BODY1 - R_BODY0) * t

    def ring(bm, r, z0, z1, mat, rivets=True, along_facets=True):
        """A brass strap around the body at circumradius r, with a rivet boss
        at every facet centre (HI only)."""
        lathe(bm, [(r, z0), (r, z1)], segs=N, mat=mat, smooth=False)
        if rivets:
            zc = (z0 + z1) * 0.5
            for k in range(N):
                a = facet(k)
                rr = r * AP + 0.02
                box(bm, (0.06, 0.13, 0.13), center=(math.cos(a) * rr, math.sin(a) * rr, zc),
                    mat=M_BRASS, rot=Matrix.Rotation(a, 3, 'Z'))

    # the door faces Blender -Y, which the exporter turns into glTF +Z: the
    # side the city lies on for a tower placed at rotY 0. Facet 6 sits at
    # 292.5 deg before the final -22.5 deg turn that squares the facets to the
    # axes, so it ends up on -Y exactly.
    DOOR_K = 6

    def arch_prism(bm, a, w, hs, r0, r1, z0, mat, segs=8):
        """A round-topped slab in the facet plane at angle `a`: `w` wide,
        `hs` of straight jamb under a semicircle, extruded radially r0->r1."""
        n = Vector((math.cos(a), math.sin(a), 0))
        t = Vector((-math.sin(a), math.cos(a), 0))
        rad = w / 2
        outline = [(-rad, 0.0), (rad, 0.0), (rad, hs)]
        for i in range(1, segs):
            th = math.pi * i / segs
            outline.append((rad * math.cos(th), hs + rad * math.sin(th)))
        outline.append((-rad, hs))
        rings = []
        for r in (r0, r1):
            rings.append([bm.verts.new(n * r + t * u + Vector((0, 0, z0 + z))) for (u, z) in outline])
        faces = []
        m = len(outline)
        for i in range(m):
            j = (i + 1) % m
            faces.append(bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i])))
        faces.append(bm.faces.new(rings[0]))
        faces.append(bm.faces.new(list(reversed(rings[1]))))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        for f in faces:
            f.material_index = mat
            f.smooth = False
        return faces

    def arch_frame(bm, a, w, th, hs, r0, r1, z0, mat, segs=8):
        """A hollow round-topped surround, `th` thick, open at the bottom:
        front ring at r1, outer walls, and the reveal walls down to r0."""
        n = Vector((math.cos(a), math.sin(a), 0))
        t = Vector((-math.sin(a), math.cos(a), 0))
        def outline(width):
            rad = width / 2
            pts = [(-rad, 0.0), (rad, 0.0), (rad, hs)]
            for i in range(1, segs):
                ang = math.pi * i / segs
                pts.append((rad * math.cos(ang), hs + rad * math.sin(ang)))
            pts.append((-rad, hs))
            return pts
        outer, inner = outline(w), outline(w - 2 * th)
        def ring(pts, r):
            return [bm.verts.new(n * r + t * u + Vector((0, 0, z0 + z))) for (u, z) in pts]
        O0, O1, I0, I1 = ring(outer, r0), ring(outer, r1), ring(inner, r0), ring(inner, r1)
        faces = []
        m = len(outer)
        for i in range(m):
            j = (i + 1) % m
            faces.append(bm.faces.new((O0[i], O0[j], O1[j], O1[i])))     # outer wall
            if i == 0:
                continue                                                # open bottom
            faces.append(bm.faces.new((O1[i], O1[j], I1[j], I1[i])))     # front ring
            faces.append(bm.faces.new((I0[i], I0[j], I1[j], I1[i])))     # reveal
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        for f in faces:
            f.material_index = mat
            f.smooth = False
        return faces

    def facade(bm, a, W, Hf, w_in, hs, r0, r1, z0, mat, segs=8):
        """A rectangular plate W x Hf with an arched hole (w_in wide, hs of
        jamb) through it, r0->r1 deep, open at the bottom. The outer outline
        is the inner arch projected onto the rectangle from the arch centre,
        so the two outlines pair up index for index."""
        n = Vector((math.cos(a), math.sin(a), 0))
        t = Vector((-math.sin(a), math.cos(a), 0))
        rad = w_in / 2
        inner = [(-rad, 0.0), (rad, 0.0), (rad, hs)]
        for i in range(1, segs):
            ang = math.pi * i / segs
            inner.append((rad * math.cos(ang), hs + rad * math.sin(ang)))
        inner.append((-rad, hs))
        outer = []
        for (u, z) in inner:
            if z <= 1e-6:
                outer.append((math.copysign(W / 2, u), 0.0))
                continue
            du, dz = u, z - hs
            tt = (W / 2) / abs(du) if abs(du) > 1e-9 else float('inf')
            if dz > 1e-9:
                tt = min(tt, (Hf - hs) / dz)
            outer.append((du * tt, hs + dz * tt))
        def ring(pts, r):
            return [bm.verts.new(n * r + t * u + Vector((0, 0, z0 + z))) for (u, z) in pts]
        O0, O1, I0, I1 = ring(outer, r0), ring(outer, r1), ring(inner, r0), ring(inner, r1)
        faces = []
        m = len(inner)
        for i in range(m):
            j = (i + 1) % m
            if i == 0:
                continue
            faces.append(bm.faces.new((O0[i], O0[j], O1[j], O1[i])))     # outer wall
            faces.append(bm.faces.new((O1[i], O1[j], I1[j], I1[i])))     # front plate
            faces.append(bm.faces.new((I0[i], I0[j], I1[j], I1[i])))     # reveal
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        for f in faces:
            f.material_index = mat
            f.smooth = False
        return faces

    def build(bm, lo):
        # ---- socle + body + crown as ONE lathe --------------------------------
        prof = [
            (R_SOCLE0, 0.00), (R_SOCLE0, 0.50), (R_SOCLE1, 0.50), (R_SOCLE1, Z_BODY0),
            (R_BODY0, Z_BODY0), (R_BODY1, Z_BODY1),
            (R_CORBEL, 6.70), (R_CORBEL, 7.00),
            (R_CORNICE, 7.00), (R_CORNICE, 7.20),
            (R_SILL, 7.20), (R_SILL, 7.30),
        ]
        lathe(bm, prof, segs=N, mat=M_STONE, smooth=False)
        # the socle steps are dark stone: re-tag the two lowest bands
        for f in bm.faces:
            zs = [v.co.z for v in f.verts]
            if max(zs) <= Z_BODY0 + 1e-4 and f.material_index == M_STONE:
                f.material_index = M_DARK

        if not lo:
            # straps: socle top, mid-body, under the corbel
            ring(bm, R_SOCLE1 + 0.03, 0.78, 0.92, M_BRASS)
            ring(bm, body_r(3.60) + 0.05, 3.53, 3.67, M_BRASS)
            ring(bm, R_CORBEL + 0.03, 6.68, 6.82, M_BRASS)
            # dentils tucked under the cornice lip, three per facet
            for k in range(N):
                a = facet(k)
                for j in (-1, 0, 1):
                    rr = R_CORBEL * AP + 0.06
                    c = Vector((math.cos(a) * rr, math.sin(a) * rr, 6.91))
                    t = Vector((-math.sin(a), math.cos(a), 0)) * (j * 0.42)
                    box(bm, (0.12, 0.17, 0.13), center=tuple(c + t), mat=M_STONE,
                        rot=Matrix.Rotation(a, 3, 'Z'))
            # rune conduits on the even facets, broken at the mid strap, with
            # a lozenge sigil on the upper span
            for k in range(1, N, 2):
                a = facet(k)
                n = Vector((math.cos(a), math.sin(a), 0))
                for (z0, z1) in ((1.20, 3.40), (3.82, 5.95)):
                    pts, radii = [], []
                    M = 7
                    for i in range(M):
                        u = i / (M - 1)
                        z = z0 + (z1 - z0) * u
                        pts.append(n * (body_r(z) * AP) + Vector((0, 0, z)))
                        radii.append(0.040 + 0.024 * math.sin(u * math.pi))
                    tube_along(bm, pts, 0.04, segs=6, mat=M_RUNE, radii=radii)
                zc = 4.90
                c = n * (body_r(zc) * AP + 0.015) + Vector((0, 0, zc))
                rot = Matrix.Rotation(a, 3, 'Z') @ Matrix.Rotation(math.radians(45), 3, 'X')
                box(bm, (0.07, 0.30, 0.30), center=tuple(c), mat=M_RUNE, rot=rot)
            # warm-lit arrow slits on the odd facets, two heights
            for k in range(0, N, 2):
                a = facet(k)
                n = Vector((math.cos(a), math.sin(a), 0))
                for zc in (2.40, 5.10):
                    if k == DOOR_K and zc < 3.0:
                        continue
                    c = n * (body_r(zc) * AP + 0.005) + Vector((0, 0, zc))
                    rot = Matrix.Rotation(a, 3, 'Z')
                    box(bm, (0.08, 0.30, 0.95), center=tuple(c), mat=M_DARK, rot=rot)
                    box(bm, (0.10, 0.16, 0.78), center=tuple(c), mat=M_WARM if (zc > 3.0 and k % 4 == 0) else M_DARK, rot=rot)  # one lit slit per tower
            # the roof lens: a brass ring around a rune seat
            torus(bm, 0.66, 0.06, major=24, minor=6, mat=M_BRASS, center=(0, 0, 7.32))
            lathe(bm, [(0.0, 0.0), (0.50, 0.03), (0.56, 0.10), (0.48, 0.16), (0.0, 0.20)],
                  segs=20, mat=M_RUNE, origin=(0, 0, 7.30))

        # ---- the door: a porch that stands proud of the socle -----------------
        a = facet(DOOR_K)
        n = Vector((math.cos(a), math.sin(a), 0))
        t = Vector((-math.sin(a), math.cos(a), 0))
        rot = Matrix.Rotation(a, 3, 'Z')
        R_FACE = R_SOCLE0 * AP + 0.45          # porch face, beyond the socle
        PORCH_S = 0.80                          # the whole porch, scaled about its foot
        porch_before = set(bm.verts)
        def rbox(size_radial, size_tan, z0, z1, r_in, r_out, mat, du=0.0):
            c = n * ((r_in + r_out) * 0.5) + t * du + Vector((0, 0, (z0 + z1) * 0.5))
            box(bm, (r_out - r_in, size_tan, z1 - z0), center=tuple(c), mat=mat, rot=rot)
        if lo:
            rbox(0, 1.50, 0.00, 2.20, 1.30, R_FACE, M_STONE)
            rbox(0, 1.70, 0.00, 0.12, R_FACE, R_FACE + 0.36, M_DARK)
        else:
            # the block stops short of the face; a plate with an arched hole
            # closes it, so the recessed leaf is the first thing a bake ray
            # meets inside the opening
            rbox(0, 1.50, 0.00, 2.04, 1.30, R_FACE - 0.26, M_STONE)
            facade(bm, a, 1.50, 1.80, 0.96, 1.10, R_FACE - 0.26, R_FACE, 0.24, M_STONE)
            rbox(0, 1.62, 2.04, 2.20, 1.30, R_FACE + 0.06, M_STONE)   # cap with a lip
            rbox(0, 1.70, 0.00, 0.12, R_FACE, R_FACE + 0.36, M_DARK)  # the step
            rbox(0, 1.50, 0.12, 0.24, R_FACE - 0.26, R_FACE + 0.12, M_DARK)  # the sill
            # a hollow stone surround proud of the block, with a real reveal,
            # and the door leaf recessed inside it: red planks, brass bands, a
            # ring handle
            arch_frame(bm, a, 1.30, 0.17, 1.10, R_FACE - 0.26, R_FACE + 0.06, 0.24, M_STONE)
            arch_prism(bm, a, 0.94, 1.10, R_FACE - 0.22, R_FACE - 0.10, 0.24, M_WOOD)
            for du in (-0.16, 0.16):
                rbox(0, 0.025, 0.28, 1.40, R_FACE - 0.11, R_FACE - 0.09, M_DARK, du=du)
            for (z0, z1) in ((0.54, 0.62), (1.08, 1.16)):
                rbox(0, 0.86, z0, z1, R_FACE - 0.11, R_FACE - 0.07, M_BRASS)
                for du in (-0.32, 0.0, 0.32):
                    c = n * (R_FACE - 0.06) + t * du + Vector((0, 0, (z0 + z1) * 0.5))
                    box(bm, (0.04, 0.09, 0.09), center=tuple(c), mat=M_BRASS, rot=rot)
            ring_pts = []
            for i in range(13):
                th = TAU * i / 12
                ring_pts.append(n * (R_FACE - 0.06) + t * (0.24 + 0.075 * math.cos(th)) + Vector((0, 0, 0.94 + 0.075 * math.sin(th))))
            tube_along(bm, ring_pts, 0.016, segs=6, mat=M_BRASS)
            # keystone + a warm lamp niche over the arch
            c = n * (R_FACE + 0.08) + Vector((0, 0, 0.24 + 1.10 + 0.57))
            box(bm, (0.16, 0.16, 0.22), center=tuple(c), mat=M_BRASS, rot=rot)
            c = n * (R_FACE + 0.01) + Vector((0, 0, 1.94))
            box(bm, (0.08, 0.24, 0.10), center=tuple(c), mat=M_WARM, rot=rot)

        # scale the porch about the point where it meets the socle at ground
        # level, so it stays attached and grounded
        porch_verts = [v for v in bm.verts if v not in porch_before]
        pv = n * (R_SOCLE0 * AP)
        bmesh.ops.translate(bm, verts=porch_verts, vec=-pv)
        bmesh.ops.scale(bm, verts=porch_verts, vec=(PORCH_S, PORCH_S, PORCH_S))
        bmesh.ops.translate(bm, verts=porch_verts, vec=pv)

        # ---- merlons on every facet -------------------------------------------
        for k in range(N):
            a = facet(k)
            rr = R_SILL * AP - 0.30
            c = (math.cos(a) * rr, math.sin(a) * rr, 0)
            rot = Matrix.Rotation(a, 3, 'Z')
            if lo:
                box(bm, (0.56, 0.62, 0.70), center=(c[0], c[1], 7.30 + 0.35), mat=M_STONE, rot=rot)
            else:
                box(bm, (0.52, 0.58, 0.58), center=(c[0], c[1], 7.30 + 0.29), mat=M_STONE, rot=rot)
                box(bm, (0.60, 0.66, 0.06), center=(c[0], c[1], 7.88 + 0.03), mat=M_BRASS, rot=rot)
                box(bm, (0.46, 0.52, 0.06), center=(c[0], c[1], 7.94 + 0.03), mat=M_BRASS, rot=rot)

        # square the facets to the axes: the door lands on -Y
        bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / N, 3, 'Z'))

    tag = "tower"
    bm = bmesh.new(); build(bm, lo=False)
    hi = new_obj(tag + "_hi", bm, mats)
    bevel_obj(hi, width=0.022, segments=1, angle_deg=40)
    LOG.append(f"hi faces={len(hi.data.polygons)}")

    bm = bmesh.new(); build(bm, lo=True)
    lo_mat = bpy.data.materials.new(tag + "_lo_tmp"); lo_mat.use_nodes = True
    lo = new_obj(tag, bm, [lo_mat])
    tris = sum(len(p.vertices) - 2 for p in lo.data.polygons)
    LOG.append(f"lo faces={len(lo.data.polygons)} tris={tris} verts={len(lo.data.vertices)}")

    uv_project([lo], angle=60, island_margin=0.006)

    def s2a(image, bake_type, samples, extrusion=0.16, ray=0.7):
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

    SIZE_T = 4096
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

    render_preview(OUT_DIR + f"/{tag}_front.png", (0.0, -13.5, 4.6), (0, 0, 4.0), size=(800, 1000))
    render_preview(OUT_DIR + f"/{tag}_door.png", (2.6, -6.2, 1.6), (0, -1.6, 1.1), size=(900, 800), fov=36)
    render_preview(OUT_DIR + f"/{tag}_quarter.png", (9.0, -10.0, 7.5), (0, 0, 4.0), size=(800, 1000))
    render_preview(OUT_DIR + f"/{tag}_top.png", (5.0, -6.0, 13.0), (0, 0, 7.2), size=(800, 800), fov=40)
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
