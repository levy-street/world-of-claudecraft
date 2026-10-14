# Deepglass ring-city stair flights: baked stone steps + flagstone rails.
#
# SPACEY, 2026-09-23: "redo the textures for the steps so the textures look like
# this image i generated ... stone rails and then brick steps with unique
# textures ... bake in the lighting ao ... so the steps look like a slick
# asset". The world-space triplanar stone on the old model/custom flights
# cannot line blocks up with individual steps, so the flights become GLBs
# with real UVs:
#
#   STAGE=bake   models high-poly stone and bakes two texture sets (Cycles, CPU):
#     - stair_steps: a COURSE ATLAS. Seven courses of bevelled, displaced
#       stone blocks laid on a real staircase (riser RISER, tread TREAD),
#       baked selected-to-active onto one riser+tread strip per course, so
#       every strip carries its own joints, the AO in them, the contact shadow
#       under the nosing and at the back of the tread. Each course is periodic
#       over the 16-yd flight width, so a flight can shift/mirror it per step.
#     - stair_flag: a seamless 6-yd tile of irregular flagstones (periodic
#       Voronoi slabs over a mortar bed) for the rails, posts and landings.
#     Base colour (through EMIT), AO and a tangent normal map are baked; the
#     AO is folded into the colour (the engine reads no occlusion map).
#   STAGE=build  builds the three flight GLBs (38 / 43 / 16 steps) at the exact
#     geometry of the citadel stairBlock flights and scripts/assets/deepglass/stair_trim_core.mjs's
#     rails and landings, UV-mapped into those textures, and renders previews.
#
# Frame: game-local yards, x across (-8..8 steps), y up, z = climb (+z up the
# flight), origin 0.5 under the foot plaza (the stairBlock origin). Blender
# coords are (x, -z, y) so export_yup lands glTF on exactly that frame. The
# rails dive 4 yd under the nosing line, so the loader must seat this kit by
# its origin (authoredGroundLine), not its lowest vertex.
#
#   STAGE=bake  /Applications/Blender.app/Contents/MacOS/Blender -b --python <this>
#   STAGE=build /Applications/Blender.app/Contents/MacOS/Blender -b --python <this>
import os
import json
import math
import random
import traceback
import zlib

LOG = []
try:
    # Repo root: a prepended REPO_ROOT, else WOC_REPO, else from __file__ (absent under a text-block or bridge exec).
    REPO_ROOT = globals().get('REPO_ROOT') or os.environ.get('WOC_REPO') or os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(globals()['__file__'])), '..', '..', '..'))
    exec(open(os.path.join(REPO_ROOT, "scripts/assets/deepglass/dg_lib.py")).read())
    import numpy as np

    OUT_DIR = os.path.join(REPO_ROOT, "tmp/asset_src/deepglass")
    os.makedirs(OUT_DIR, exist_ok=True)
    STAGE = os.environ.get("STAGE", "bake")

    # ---- shared geometry (must match scripts/assets/deepglass/stair_trim_core.mjs) ------
    BASE, LIFT = 0.5, 0.08
    HALF_W = 8.0
    RAIL_H, RAIL_DEPTH, POST_UP = 0.85, 4.0, 0.3
    LAND, SLAB, LAND_LIFT = 3.0, 0.6, 0.03
    FLIGHTS = {
        # name: steps, rise, run, rail thickness, post size
        "stair_flight_38": (38, 14.0, 26.0, 5.6, 5.6),
        "stair_flight_43": (43, 16.0, 26.0, 5.6, 5.6),
        "stair_flight_16": (16, 6.0, 26.0, 0.7, 0.9),
    }

    # ---- atlas layout -------------------------------------------------------
    RISER, TREAD = 0.372, 0.65          # the bake stair's profile
    COURSES = 7
    ATLAS_W, ATLAS_H = 2048, 1024       # 128 px/yd across, ~129 px/yd up
    PAD = 7.0 / ATLAS_H                 # row padding (mip bleed)
    ROW = 1.0 / COURSES
    FLAG_TILE = 7.5                     # yd per flagstone repeat (slabs ~1.3 yd)
    FLAG_RES = 1024                     # 136 px/yd

    def row_v(c):
        """v0 (riser bottom), v1 (nosing), v2 (tread back) of course c."""
        v0 = c * ROW + PAD
        v2 = (c + 1) * ROW - PAD
        v1 = v0 + (v2 - v0) * RISER / (RISER + TREAD)
        return v0, v1, v2

    def B(x, y, z):
        """game-local (x, y up, z climb) -> Blender (x, -z, y)."""
        return Vector((x, -z, y))

    def lin(h):
        return srgb(h)[:3]

    # Blender 5's Mix node carries float/vector/colour/rotation twins of every
    # socket: pick them by (name, type), never by index.
    def sk(node, name, typ, out=False):
        for x in (node.outputs if out else node.inputs):
            if x.name == name and x.type == typ:
                return x
        raise KeyError(f"{node.bl_idname}.{name}:{typ}")

    def mix_rgb(nt, blend="MIX"):
        m = nt.nodes.new("ShaderNodeMix"); m.data_type = "RGBA"; m.blend_type = blend
        return m, sk(m, "Factor", "VALUE"), sk(m, "A", "RGBA"), sk(m, "B", "RGBA"), sk(m, "Result", "RGBA", True)

    # ---- materials ----------------------------------------------------------
    def stone_material(name, warm, cool, light, jitter=(0.78, 1.17), mottle=1.4, pointy=0.5):
        """Painted-look stone: per-stone tint (face attributes rand/rand2),
        soft mottle, speckle, tiny dark pits, lighter worn arrises
        (Cycles pointiness) and a chisel bump. BASECOL is the colour node the
        EMIT bake reads."""
        mat = bpy.data.materials.new(name)
        nt, bsdf = _nodes(mat)
        L = nt.links
        a1 = nt.nodes.new("ShaderNodeAttribute"); a1.attribute_name = "rand"; a1.attribute_type = "GEOMETRY"
        a2 = nt.nodes.new("ShaderNodeAttribute"); a2.attribute_name = "rand2"; a2.attribute_type = "GEOMETRY"
        tc = nt.nodes.new("ShaderNodeTexCoord")
        _, t_f, t_a, t_b, t_out = mix_rgb(nt)
        t_a.default_value = (*warm, 1); t_b.default_value = (*cool, 1)
        L.new(a2.outputs["Fac"], t_f)
        val = nt.nodes.new("ShaderNodeMapRange")
        val.inputs["To Min"].default_value, val.inputs["To Max"].default_value = jitter
        L.new(a1.outputs["Fac"], val.inputs["Value"])

        def noise(scale, detail, rough=0.55):
            n = nt.nodes.new("ShaderNodeTexNoise")
            n.inputs["Scale"].default_value = scale
            n.inputs["Detail"].default_value = detail
            n.inputs["Roughness"].default_value = rough
            L.new(tc.outputs["Object"], n.inputs["Vector"])
            return n

        def remap(src, lo, hi, a, b):
            m = nt.nodes.new("ShaderNodeMapRange")
            m.inputs["From Min"].default_value, m.inputs["From Max"].default_value = lo, hi
            m.inputs["To Min"].default_value, m.inputs["To Max"].default_value = a, b
            L.new(src, m.inputs["Value"])
            return m.outputs["Result"]

        def mul(col, fac_socket):
            _, f, a, b, out = mix_rgb(nt, "MULTIPLY")
            f.default_value = 1.0
            L.new(col, a)
            c = nt.nodes.new("ShaderNodeCombineColor")
            L.new(fac_socket, c.inputs[0]); L.new(fac_socket, c.inputs[1]); L.new(fac_socket, c.inputs[2])
            L.new(c.outputs[0], b)
            return out

        col = mul(t_out, val.outputs["Result"])
        col = mul(col, remap(noise(mottle, 4.0).outputs["Fac"], 0.3, 0.7, 0.86, 1.12))
        col = mul(col, remap(noise(mottle * 3.2, 6.0).outputs["Fac"], 0.3, 0.7, 0.9, 1.08))
        col = mul(col, remap(noise(18.0, 3.0).outputs["Fac"], 0.35, 0.65, 0.86, 1.1))
        lf = nt.nodes.new("ShaderNodeTexVoronoi"); lf.inputs["Scale"].default_value = 62.0
        L.new(tc.outputs["Object"], lf.inputs["Vector"])
        col = mul(col, remap(lf.outputs["Distance"], 0.0, 0.07, 1.16, 1.0))
        # weathered patches: a few darker, damp-looking clouds per stone
        col = mul(col, remap(noise(2.2, 3.0).outputs["Fac"], 0.55, 0.7, 1.0, 0.84))
        pits = nt.nodes.new("ShaderNodeTexVoronoi"); pits.inputs["Scale"].default_value = 45.0
        L.new(tc.outputs["Object"], pits.inputs["Vector"])
        col = mul(col, remap(pits.outputs["Distance"], 0.02, 0.1, 0.62, 1.0))
        # hairline cracks, only where a slow mask lets them through
        crk = nt.nodes.new("ShaderNodeTexVoronoi"); crk.feature = "DISTANCE_TO_EDGE"
        crk.inputs["Scale"].default_value = 2.2
        warp = noise(3.0, 4.0)
        wv = nt.nodes.new("ShaderNodeVectorMath"); wv.operation = "MULTIPLY_ADD"
        L.new(warp.outputs["Color"], wv.inputs[0])
        wv.inputs[1].default_value = (0.22, 0.22, 0.22)
        L.new(tc.outputs["Object"], wv.inputs[2])
        L.new(wv.outputs[0], crk.inputs["Vector"])
        crack = remap(crk.outputs["Distance"], 0.0, 0.009, 0.74, 1.0)
        cmask = remap(noise(0.9, 2.0).outputs["Fac"], 0.6, 0.65, 0.0, 1.0)
        cm, cm_f, cm_a, cm_b, cm_out = mix_rgb(nt)
        L.new(cmask, cm_f)
        cm_a.default_value = (1, 1, 1, 1)
        cc = nt.nodes.new("ShaderNodeCombineColor")
        L.new(crack, cc.inputs[0]); L.new(crack, cc.inputs[1]); L.new(crack, cc.inputs[2])
        L.new(cc.outputs[0], cm_b)
        mm, mm_f, mm_a, mm_b, mm_out = mix_rgb(nt, "MULTIPLY")
        mm_f.default_value = 1.0
        L.new(col, mm_a); L.new(cm_out, mm_b)
        col = mm_out
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        edge = remap(geo.outputs["Pointiness"], pointy + 0.015, pointy + 0.075, 0.0, 1.0)
        hi, h_f, h_a, h_b, h_out = mix_rgb(nt)
        hi.name = "BASECOL"
        L.new(col, h_a); h_b.default_value = (*light, 1)
        # the arris lightens only part way: worn, not chalked
        fac = nt.nodes.new("ShaderNodeMath"); fac.operation = "MULTIPLY"; fac.inputs[1].default_value = 0.7
        L.new(edge, fac.inputs[0]); L.new(fac.outputs[0], h_f)
        L.new(h_out, bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.85
        bump_mix = nt.nodes.new("ShaderNodeMath"); bump_mix.operation = "ADD"
        chip = nt.nodes.new("ShaderNodeTexVoronoi"); chip.inputs["Scale"].default_value = 6.0
        L.new(tc.outputs["Object"], chip.inputs["Vector"])
        L.new(chip.outputs["Distance"], bump_mix.inputs[0])
        fine = noise(10.0, 8.0, 0.62)
        L.new(fine.outputs["Fac"], bump_mix.inputs[1])
        bump = nt.nodes.new("ShaderNodeBump"); bump.name = "BUMP"
        bump.inputs["Strength"].default_value = 0.55
        bump.inputs["Distance"].default_value = 0.012
        L.new(bump_mix.outputs[0], bump.inputs["Height"])
        L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        return mat

    def mortar_material(name):
        mat = bpy.data.materials.new(name)
        nt, bsdf = _nodes(mat)
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 30.0
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        c, c_f, c_a, c_b, c_out = mix_rgb(nt)
        c.name = "BASECOL"
        c_a.default_value = (*lin(0x3e3b37), 1); c_b.default_value = (*lin(0x5b5751), 1)
        nt.links.new(nz.outputs["Fac"], c_f)
        nt.links.new(c_out, bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 1.0
        return mat

    def emit_swap(mats, on):
        """Route BASECOL through an Emission shader (EMIT bake) and back."""
        for m in mats:
            nt = m.node_tree
            out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
            bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
            if on:
                em = nt.nodes.new("ShaderNodeEmission"); em.name = "EMIT_SWAP"
                src = nt.nodes["BASECOL"]
                nt.links.new(sk(src, "Result", "RGBA", True), em.inputs["Color"])
                nt.links.new(em.outputs[0], out.inputs["Surface"])
            else:
                em = nt.nodes.get("EMIT_SWAP")
                if em:
                    nt.nodes.remove(em)
                nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    # ---- high-poly accumulation ---------------------------------------------
    DISP = bpy.data.textures.new("stair_disp", type="CLOUDS")
    DISP.noise_scale = 0.22
    DISP.noise_depth = 2

    def solid_into(acc, bm_src, mat_index, r1, r2, bevel_w, disp=0.009, subd=3):
        """Bevel + simple-subdivide + displace one closed solid and append it
        (world coords) to the accumulator with its per-stone attributes."""
        me = bpy.data.meshes.new("_s")
        bm_src.to_mesh(me)
        bm_src.free()
        ob = bpy.data.objects.new("_s", me)
        bpy.context.scene.collection.objects.link(ob)
        bv = ob.modifiers.new("b", "BEVEL")
        bv.width = bevel_w; bv.segments = 4; bv.limit_method = "ANGLE"
        bv.angle_limit = math.radians(40); bv.profile = 0.5
        sd = ob.modifiers.new("s", "SUBSURF")
        sd.subdivision_type = "SIMPLE"; sd.levels = subd; sd.render_levels = subd
        if disp > 0:
            dp = ob.modifiers.new("d", "DISPLACE")
            dp.texture = DISP; dp.texture_coords = "GLOBAL"
            dp.strength = disp; dp.mid_level = 0.5
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        em = ev.to_mesh()
        n0 = len(acc["bm"].faces)
        acc["bm"].from_mesh(em)
        ev.to_mesh_clear()
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.meshes.remove(me)
        bm = acc["bm"]
        bm.faces.ensure_lookup_table()
        l1, l2 = acc["l1"], acc["l2"]
        for f in bm.faces[n0:]:
            f[l1] = r1
            f[l2] = r2
            f.material_index = mat_index

    def smooth_high(ob):
        """Smooth-shade the high-poly with face-area weighted normals: the big
        flat faces stay flat and the bevels roll over smoothly. Flat shading
        baked every bevel segment as its own band (hard stepped rims)."""
        for p_ in ob.data.polygons:
            p_.use_smooth = True
        wn = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
        wn.mode = "FACE_AREA"
        wn.weight = 50
        wn.keep_sharp = True
        return ob

    def new_acc():
        bm = bmesh.new()
        return {"bm": bm, "l1": bm.faces.layers.float.new("rand"), "l2": bm.faces.layers.float.new("rand2")}

    def box_bm(x0, x1, y0, y1, z0, z1, rot=(0.0, 0.0)):
        """Game-local AABB as a Blender bmesh, optionally rocked about its
        centre by (pitch about x, yaw about y) radians."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        c = B((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        s = (x1 - x0, z1 - z0, y1 - y0)
        for v in bm.verts:
            v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]))
        if rot != (0.0, 0.0):
            R = Matrix.Rotation(rot[0], 3, "X") @ Matrix.Rotation(rot[1], 3, "Z")
            for v in bm.verts:
                v.co = R @ v.co
        for v in bm.verts:
            v.co += c
        return bm

    def add_quads(bm, uvl, quads, mat_index=0):
        """quads: [(4 game-local corners, 4 uvs, game-local outward normal)].
        The winding is set from the normal: a selected-to-active bake casts
        from the face's front, so a riser facing into the stair bakes the
        inside of the stone (black AO, inverted normals)."""
        for corners, uvs, nrm in quads:
            ps = [B(*p) for p in corners]
            uvs = list(uvs)
            if (ps[1] - ps[0]).cross(ps[2] - ps[0]).dot(B(*nrm)) < 0:
                ps.reverse()
                uvs.reverse()
            f = bm.faces.new([bm.verts.new(p) for p in ps])
            f.material_index = mat_index
            for lp, uv in zip(f.loops, uvs):
                lp[uvl].uv = uv

    def plane_obj(name, quads, mat):
        bm = bmesh.new()
        add_quads(bm, bm.loops.layers.uv.new("UVMap"), quads)
        return new_obj(name, bm, [mat])

    def img(name, w, h, is_data=False, fill=(0, 0, 0, 1)):
        im = bpy.data.images.get(name)
        if im:
            bpy.data.images.remove(im)
        im = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False, is_data=is_data)
        im.generated_color = fill
        return im

    def bake_s2a(high, low, image, bake_type, samples, extrusion=0.05, ray=0.16, margin=6):
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.samples = samples
        b = sc.render.bake
        b.use_selected_to_active = True
        b.cage_extrusion = extrusion
        b.max_ray_distance = ray
        b.margin = margin
        b.use_clear = True
        b.normal_space = "TANGENT"
        m = low.data.materials[0]
        n = m.node_tree.nodes.get("BAKE_TARGET")
        n.image = image
        m.node_tree.nodes.active = n
        with bpy.context.temp_override(**ctx_override()):
            for o in bpy.data.objects:
                o.select_set(False)
            high.select_set(True)
            low.select_set(True)
            bpy.context.view_layer.objects.active = low
            bpy.ops.object.bake(type=bake_type)

    def target_material(name):
        mat = bpy.data.materials.new(name)
        nt, bsdf = _nodes(mat)
        t = nt.nodes.new("ShaderNodeTexImage"); t.name = "BAKE_TARGET"
        return mat

    def fold_ao(base, ao, amount):
        n = base.size[0] * base.size[1] * 4
        c = np.empty(n, dtype=np.float32); base.pixels.foreach_get(c)
        a = np.empty(n, dtype=np.float32); ao.pixels.foreach_get(a)
        occ = 1.0 - (1.0 - a.reshape(-1, 4)[:, 0]) * amount
        c = c.reshape(-1, 4)
        c[:, 0:3] *= occ[:, None]
        base.pixels.foreach_set(c.reshape(-1))
        base.update()

    def bake_sky(high, low, image, samples=64):
        """Irradiance under a uniform white sky (DIFFUSE, lighting only): the
        soft 'baked lighting' - treads brighter than risers, upward chamfers
        catching light, joints and inside corners falling off. Yaw-free, so it
        stays right whichever way a flight faces the game's sun."""
        sc = bpy.context.scene
        bg = sc.world.node_tree.nodes.get("Background")
        keep = (tuple(bg.inputs["Color"].default_value), bg.inputs["Strength"].default_value)
        bg.inputs["Color"].default_value = (1, 1, 1, 1)
        bg.inputs["Strength"].default_value = 1.0
        b = sc.render.bake
        b.use_pass_direct = True
        b.use_pass_indirect = True
        b.use_pass_color = False
        try:
            bake_s2a(high, low, image, "DIFFUSE", samples)
        finally:
            bg.inputs["Color"].default_value = keep[0]
            bg.inputs["Strength"].default_value = keep[1]

    def fold_sky(base, sky, amount):
        """base *= 1 - amount * (1 - sky / open), 'open' = the unoccluded
        top-face level (95th percentile)."""
        n = base.size[0] * base.size[1] * 4
        c = np.empty(n, dtype=np.float32); base.pixels.foreach_get(c)
        a = np.empty(n, dtype=np.float32); sky.pixels.foreach_get(a)
        irr = a.reshape(-1, 4)[:, 0]
        ref = float(np.percentile(irr, 95)) or 1.0
        f = 1.0 - amount * (1.0 - np.clip(irr / ref, 0.0, 1.08))
        c = c.reshape(-1, 4)
        c[:, 0:3] *= f[:, None]
        base.pixels.foreach_set(c.reshape(-1))
        base.update()
        return ref

    def rim_highlight(base, geo, amount):
        """Worn arrises: lighten where the shape normal first tips over the
        edge (the outer bevel), not where it plunges into the joint (the sky
        fold darkens that part)."""
        n = base.size[0] * base.size[1] * 4
        c = np.empty(n, dtype=np.float32); base.pixels.foreach_get(c)
        g = np.empty(n, dtype=np.float32); geo.pixels.foreach_get(g)
        g = g.reshape(-1, 4)
        d = np.hypot(g[:, 0] * 2 - 1, g[:, 1] * 2 - 1)

        def sstep(a, b, x):
            t = np.clip((x - a) / (b - a), 0, 1)
            return t * t * (3 - 2 * t)

        rim = sstep(0.04, 0.3, d) * (1 - sstep(0.4, 0.8, d))
        c = c.reshape(-1, 4)
        c[:, 0:3] = np.minimum(1.0, c[:, 0:3] * (1 + amount * rim[:, None]))
        base.pixels.foreach_set(c.reshape(-1))
        base.update()

    def bake_set(tag, high, low, mats, w, h, ao_dist, ao_amount, sky_amount=0.42, rim_amount=0.16):
        sc = bpy.context.scene
        sc.world.light_settings.distance = ao_dist
        base = img(tag + "_base", w, h)
        ao = img(tag + "_ao", w, h, is_data=True, fill=(1, 1, 1, 1))
        nrm = img(tag + "_norm", w, h, is_data=True, fill=(0.5, 0.5, 1, 1))
        emit_swap(mats, True)
        try:
            bake_s2a(high, low, base, "EMIT", 16)
        finally:
            emit_swap(mats, False)
        LOG.append(f"{tag}: base baked")
        bake_s2a(high, low, ao, "AO", 128)
        LOG.append(f"{tag}: ao baked")
        bake_s2a(high, low, nrm, "NORMAL", 16)
        LOG.append(f"{tag}: normal baked")
        # shape normals: the same bake with the chisel bump off, so the edge
        # highlight follows the bevels and not the grain
        geo = img(tag + "_geonorm", w, h, is_data=True, fill=(0.5, 0.5, 1, 1))
        keep = []
        for m in mats:
            b_ = m.node_tree.nodes.get("BUMP")
            if b_:
                keep.append((b_, b_.inputs["Strength"].default_value))
                b_.inputs["Strength"].default_value = 0.0
        try:
            bake_s2a(high, low, geo, "NORMAL", 8)
        finally:
            for b_, v_ in keep:
                b_.inputs["Strength"].default_value = v_
        sky = img(tag + "_sky", w, h, is_data=True, fill=(1, 1, 1, 1))
        bake_sky(high, low, sky)
        save_img(sky, f"{OUT_DIR}/{tag}_sky.png")
        save_img(ao, f"{OUT_DIR}/{tag}_ao.png")
        fold_ao(base, ao, ao_amount)
        rim_highlight(base, geo, rim_amount)
        ref = fold_sky(base, sky, sky_amount)
        LOG.append(f"{tag}: sky baked (open level {ref:.3f})")
        save_img(base, f"{OUT_DIR}/{tag}_base.png")
        save_img(nrm, f"{OUT_DIR}/{tag}_norm.png")

    # ======================================================================
    if STAGE == "bake":
        reset_scene()
        sc = bpy.context.scene
        if sc.world is None:
            sc.world = bpy.data.worlds.new("W")
        sc.world.use_nodes = True
        rng = random.Random(20260923)

        # stone palettes (sRGB hexes): a cool Warden grey that drifts warm or
        # blue stone to stone, the paving hue SPACEY matched the steps to
        STEP_WARM, STEP_COOL, STEP_LIGHT = lin(0xb4afa6), lin(0xaaadb0), lin(0xdcdcd8)
        m_block = stone_material("stair_block", STEP_WARM, STEP_COOL, STEP_LIGHT)
        m_mortar = mortar_material("stair_mortar")

        # ---- 1. step course atlas --------------------------------------------
        PERIOD = 2 * HALF_W
        GAP = 0.028
        courses = []
        prev = []
        for k in range(COURSES + 1):  # +1: an occluder course above the top one
            for _try in range(400):
                m = rng.choice([8, 9, 9, 10])
                ls = [rng.uniform(1.1, 2.6) for _ in range(m)]
                s = sum(ls)
                ls = [l * PERIOD / s for l in ls]
                if min(ls) < 1.0:
                    continue
                off = rng.uniform(0, PERIOD)
                js = []
                x = off
                for l in ls:
                    js.append(x % PERIOD)
                    x += l

                def cd(a, b):
                    d = abs(a - b) % PERIOD
                    return min(d, PERIOD - d)

                if all(cd(a, b) >= 0.35 for a in js for b in prev):
                    break
            courses.append((js, ls, off))
            prev = js

        acc = new_acc()
        for k, (js, ls, off) in enumerate(courses):
            y_lo, y_hi = k * RISER, (k + 1) * RISER
            z_lo, z_hi = k * TREAD, (k + 1) * TREAD
            x = off - 2 * PERIOD  # off is in [0, PERIOD): four periods cover the band
            for rep in range(4):
                for l in ls:
                    a, b = x + GAP / 2, x + l - GAP / 2
                    x += l
                    if b < -HALF_W - 2.2 or a > HALF_W + 2.2:
                        continue
                    r1, r2 = rng.random(), rng.random()
                    inset = rng.uniform(0.0, 0.012)
                    rise = rng.uniform(-0.006, 0.006)
                    rot = (math.radians(rng.uniform(-0.35, 0.35)), math.radians(rng.uniform(-0.3, 0.3)))
                    bm = box_bm(a, b, y_lo - 0.22, y_hi + rise, z_lo + inset, z_hi + 0.3, rot)
                    solid_into(acc, bm, 0, r1, r2, rng.uniform(0.04, 0.06))
            # mortar beds behind the riser joints and under the tread joints
            mb = box_bm(-HALF_W - 2.3, HALF_W + 2.3, y_lo - 0.2, y_hi - 0.035, z_lo + 0.035, z_hi + 0.3)
            solid_into(acc, mb, 1, 0.5, 0.5, 0.005, disp=0.0, subd=0)
        # foot floor under course 0 (occluder only)
        fb = box_bm(-HALF_W - 2.3, HALF_W + 2.3, -0.4, 0.0, -2.0, 0.02)
        solid_into(acc, fb, 1, 0.5, 0.5, 0.005, disp=0.0, subd=0)
        high = smooth_high(new_obj("steps_high", acc["bm"], [m_block, m_mortar]))
        LOG.append(f"steps high-poly: {len(high.data.polygons)} faces")

        quads = []
        for k in range(COURSES):
            v0, v1, v2 = row_v(k)
            y_lo, y_hi = k * RISER, (k + 1) * RISER
            z_lo, z_hi = k * TREAD, (k + 1) * TREAD
            quads.append(([(-HALF_W, y_lo, z_lo), (HALF_W, y_lo, z_lo), (HALF_W, y_hi, z_lo), (-HALF_W, y_hi, z_lo)],
                          [(0, v0), (1, v0), (1, v1), (0, v1)], (0, 0, -1)))
            quads.append(([(-HALF_W, y_hi, z_lo), (HALF_W, y_hi, z_lo), (HALF_W, y_hi, z_hi), (-HALF_W, y_hi, z_hi)],
                          [(0, v1), (1, v1), (1, v2), (0, v2)], (0, 1, 0)))
        low = plane_obj("steps_low", quads, target_material("steps_target"))
        bake_set("stair_steps", high, low, [m_block, m_mortar], ATLAS_W, ATLAS_H, ao_dist=0.45, ao_amount=0.7)
        json.dump({
            "riser": RISER, "tread": TREAD, "courses": COURSES, "period": PERIOD,
            # joint x positions of each course, in atlas u (0..1 over the period)
            "joints": [[((j + HALF_W) % PERIOD) / PERIOD for j in courses[k][0]] for k in range(COURSES)],
        }, open(f"{OUT_DIR}/stair_steps_atlas.json", "w"), indent=1)
        for o in (high, low):
            bpy.data.objects.remove(o, do_unlink=True)

        # ---- 2. flagstone tile -------------------------------------------------
        FLAG_WARM, FLAG_COOL, FLAG_LIGHT = lin(0xb3aea5), lin(0xa9acb0), lin(0xdcdcd8)
        m_flag = stone_material("stair_flag", FLAG_WARM, FLAG_COOL, FLAG_LIGHT, jitter=(0.8, 1.15), mottle=1.2)
        S = FLAG_TILE
        STRETCH = 1.35  # slabs run long along u (the rail's length on its sides)
        pts = []
        for _ in range(4000):  # periodic Poisson-disk seeds in the stretched space
            if len(pts) >= 34:
                break
            q = (rng.uniform(0, S), rng.uniform(0, S))
            r = rng.uniform(0.78, 1.3)  # stretched yards: slabs ~1.1-1.7 yd

            def dist(a, b):
                dx = abs(a[0] - b[0]); dx = min(dx, S - dx)
                dy = abs(a[1] - b[1]); dy = min(dy, S - dy)
                return math.hypot(dx / STRETCH, dy)

            if all(dist(q, o) >= r for o in pts):
                pts.append(q)
        LOG.append(f"flag seeds: {len(pts)}")
        def all_copies(ps):
            return [(x + dx * S, y + dy * S, i) for i, (x, y) in enumerate(ps) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]

        def clip(poly, px, py, nx, ny, d):
            """Keep the side of the line n.p <= d."""
            out = []
            for i in range(len(poly)):
                a, b = poly[i], poly[(i + 1) % len(poly)]
                da = a[0] * nx + a[1] * ny - d
                db = b[0] * nx + b[1] * ny - d
                if da <= 0:
                    out.append(a)
                if (da <= 0) != (db <= 0):
                    t = da / (da - db)
                    out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            return out

        def cell(sx, sy, others, shrink):
            """Voronoi cell in the stretched metric (x / STRETCH), returned in
            tile space; `shrink` opens the joint (in stretched units)."""
            sx, sy = sx / STRETCH, sy
            others = [(ox / STRETCH, oy, i) for ox, oy, i in others]
            poly = [(sx - S, sy - S), (sx + S, sy - S), (sx + S, sy + S), (sx - S, sy + S)]
            for ox, oy, _ in others:
                if abs(ox - sx) < 1e-9 and abs(oy - sy) < 1e-9:
                    continue
                nx, ny = ox - sx, oy - sy
                ln = math.hypot(nx, ny)
                if ln > S * 0.9:
                    continue
                nx, ny = nx / ln, ny / ln
                mx, my = (sx + ox) / 2, (sy + oy) / 2
                poly = clip(poly, 0, 0, nx, ny, mx * nx + my * ny - shrink)
                if len(poly) < 3:
                    break
            return [(px * STRETCH, py) for px, py in poly]

        for _ in range(0):  # no Lloyd: keep the slabs irregular
            cps = all_copies(pts)
            new = []
            for (x, y) in pts:
                poly = cell(x, y, cps, 0.0)
                cx = sum(p[0] for p in poly) / len(poly)
                cy = sum(p[1] for p in poly) / len(poly)
                new.append((cx % S, cy % S))
            pts = new
        cps = all_copies(pts)
        seeds_r = [(rng.random(), rng.random(), rng.uniform(-0.012, 0.012),
                    rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7), rng.uniform(0.055, 0.08)) for _ in pts]
        acc = new_acc()
        for (x, y, i) in cps:
            if not (-1.6 < x < S + 1.6 and -1.6 < y < S + 1.6):
                continue
            poly = cell(x, y, cps, 0.022)
            if len(poly) < 3:
                continue
            r1, r2, h, tx, ty, bw = seeds_r[i]
            bm = bmesh.new()
            top = [bm.verts.new((px, py, h)) for px, py in poly]
            bot = [bm.verts.new((px, py, -0.18)) for px, py in poly]
            bm.faces.new(top)
            bm.faces.new(list(reversed(bot)))
            n = len(poly)
            for j in range(n):
                bm.faces.new([bot[j], bot[(j + 1) % n], top[(j + 1) % n], top[j]])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            R = Matrix.Rotation(math.radians(tx), 3, "X") @ Matrix.Rotation(math.radians(ty), 3, "Y")
            c = Vector((x, y, 0))
            for v in bm.verts:
                v.co = R @ (v.co - c) + c
            solid_into(acc, bm, 0, r1, r2, bw, disp=0.007)
        bed = bmesh.new()
        for v in [(-2, -2), (S + 2, -2), (S + 2, S + 2), (-2, S + 2)]:
            bed.verts.new((v[0], v[1], -0.045))
        bed.faces.new(bed.verts)
        me = bpy.data.meshes.new("_bed"); bed.to_mesh(me); bed.free()
        n0 = len(acc["bm"].faces)
        acc["bm"].from_mesh(me)
        acc["bm"].faces.ensure_lookup_table()
        for f in acc["bm"].faces[n0:]:
            f.material_index = 1
        high = smooth_high(new_obj("flag_high", acc["bm"], [m_flag, m_mortar]))
        LOG.append(f"flag high-poly: {len(high.data.polygons)} faces")
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new("UVMap")
        vs = [bm.verts.new((x, y, 0.0)) for x, y in [(0, 0), (S, 0), (S, S), (0, S)]]
        f = bm.faces.new(vs)
        for lp, uv in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            lp[uvl].uv = uv
        low = new_obj("flag_low", bm, [target_material("flag_target")])
        bake_set("stair_flag", high, low, [m_flag, m_mortar], FLAG_RES, FLAG_RES, ao_dist=0.3, ao_amount=0.8)
        LOG.append("bake stage done")

    # ======================================================================
    elif STAGE == "build":
        reset_scene()
        sc = bpy.context.scene
        atlas = json.load(open(f"{OUT_DIR}/stair_steps_atlas.json"))
        JOINTS = atlas["joints"]
        ONLY = os.environ.get("ONLY")
        PREVIEW = os.environ.get("PREVIEW", "1") == "1"

        def tex_material(name, tag):
            mat = bpy.data.materials.new(name)
            nt, bsdf = _nodes(mat)
            bi = bpy.data.images.load(f"{OUT_DIR}/{tag}_base.png")
            ni = bpy.data.images.load(f"{OUT_DIR}/{tag}_norm.png")
            ni.colorspace_settings.name = "Non-Color"  # a LOADED image: safe
            tb = nt.nodes.new("ShaderNodeTexImage"); tb.image = bi
            tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = ni
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
            nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
            bsdf.inputs["Roughness"].default_value = 0.85
            return mat

        m_steps = tex_material("stair_steps", "stair_steps")
        m_stone = tex_material("stair_stone", "stair_flag")

        def pick_courses(n, rng):
            """Per step: (course, u shift, mirrored). Never the same course
            twice running, and the shift that keeps its joints furthest from
            the step below's (staggered like laid stone)."""
            out, prev_c, prev_j = [], None, []

            def cd(a, b):
                d = abs(a - b) % 16.0
                return min(d, 16.0 - d)

            for _ in range(n):
                best = None
                for _t in range(96):
                    c = rng.randrange(COURSES)
                    if c == prev_c:
                        continue
                    s_, m_ = rng.random(), rng.random() < 0.5
                    js = [16.0 * (((s_ + 1.0 - u) if m_ else (u - s_)) % 1.0) - 8.0 for u in JOINTS[c]]
                    d = min((cd(a, b) for a in js for b in prev_j), default=9.0)
                    if best is None or d > best[0]:
                        best = (d, c, s_, m_, js)
                    if d > 0.55:
                        break
                _, c, s_, m_, js = best
                out.append((c, s_, m_))
                prev_c, prev_j = c, js
            return out

        def closed_box(bm, x0, x1, z0, z1, top0, top1, bot0, bot1):
            """Closed solid: x in [x0,x1], z in [z0,z1], top/bottom heights
            given at z0 and z1 (a sloped rail or a flat slab/post)."""
            g = [(x0, bot0, z0), (x1, bot0, z0), (x1, bot1, z1), (x0, bot1, z1),
                 (x0, top0, z0), (x1, top0, z0), (x1, top1, z1), (x0, top1, z1)]
            v = [bm.verts.new(B(*p)) for p in g]
            for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
                bm.faces.new([v[i] for i in f])

        def stone_uv(bm, uvl, faces):
            """Box-project the flagstone tile in yards, following a slope along
            its fall line so the slabs on a rail top are not stretched."""
            for f in faces:
                n = f.normal
                g = (n.x, n.z, -n.y)
                ax = max(range(3), key=lambda k: abs(g[k]))
                for lp in f.loops:
                    p = lp.vert.co
                    x, y, z = p.x, p.z, -p.y
                    if ax == 1:
                        u, v = x, z / max(abs(g[1]), 0.5)
                    elif ax == 0:
                        u, v = z, y
                    else:
                        u, v = x, y
                    lp[uvl].uv = (u / FLAG_TILE, v / FLAG_TILE)

        def build_flight(name, n, rise, run, RT, POST, rng):
            riser, tread = rise / n, run / n
            z_min, z_max = -run / 2, run / 2

            def ytop(i):
                return BASE + LIFT + (i + 1) * riser

            def nose(z):
                return BASE + LIFT + riser + (z - z_min) * riser / tread

            steps_q, stone_q = [], []
            for i, (c, s_, m_) in enumerate(pick_courses(n, rng)):
                v0, v1, v2 = row_v(c)
                ua, ub = (s_ + 1.0, s_) if m_ else (s_, s_ + 1.0)
                z0, z1 = z_min + i * tread, z_min + (i + 1) * tread
                yb = BASE if i == 0 else ytop(i - 1)
                yt = ytop(i)
                steps_q.append(([(-HALF_W, yb, z0), (HALF_W, yb, z0), (HALF_W, yt, z0), (-HALF_W, yt, z0)],
                                [(ua, v0), (ub, v0), (ub, v1), (ua, v1)], (0, 0, -1)))
                if tread > 1.0:
                    # a deep (arena) tread: the course's nosing half at the front,
                    # its back half (AO under the next riser) at the back, and
                    # flagstone paving between
                    vm = (v1 + v2) / 2
                    zf, zb = z0 + TREAD / 2, z1 - TREAD / 2
                    steps_q.append(([(-HALF_W, yt, z0), (HALF_W, yt, z0), (HALF_W, yt, zf), (-HALF_W, yt, zf)],
                                    [(ua, v1), (ub, v1), (ub, vm), (ua, vm)], (0, 1, 0)))
                    steps_q.append(([(-HALF_W, yt, zb), (HALF_W, yt, zb), (HALF_W, yt, z1), (-HALF_W, yt, z1)],
                                    [(ua, vm), (ub, vm), (ub, v2), (ua, v2)], (0, 1, 0)))
                    stone_q.append(([(-HALF_W, yt, zf), (HALF_W, yt, zf), (HALF_W, yt, zb), (-HALF_W, yt, zb)],
                                    [(0, 0)] * 4, (0, 1, 0)))
                else:
                    steps_q.append(([(-HALF_W, yt, z0), (HALF_W, yt, z0), (HALF_W, yt, z1), (-HALF_W, yt, z1)],
                                    [(ua, v1), (ub, v1), (ub, v2), (ua, v2)], (0, 1, 0)))

            # rails, posts and landings: closed solids, bevelled, then UV'd
            tb = bmesh.new()
            rail_top = lambda z: nose(z) + RAIL_H
            rail_bot = lambda z: nose(z) - RAIL_DEPTH
            for side in (-1, 1):
                xi, xo = side * HALF_W, side * (HALF_W + RT)
                x0, x1 = min(xi, xo), max(xi, xo)
                closed_box(tb, x0, x1, z_min, z_max, rail_top(z_min), rail_top(z_max), rail_bot(z_min), rail_bot(z_max))
                xc = side * (HALF_W + RT / 2)
                for zc in (z_min, z_max):
                    t = rail_top(zc) + POST_UP
                    b = rail_bot(zc)
                    closed_box(tb, xc - POST / 2, xc + POST / 2, zc - POST / 2, zc + POST / 2, t, t, b, b)
            w_half = HALF_W + RT
            foot_top = BASE + LAND_LIFT
            head_top = BASE + LIFT + rise
            closed_box(tb, -w_half, w_half, z_min - LAND, z_min, foot_top, foot_top, foot_top - SLAB, foot_top - SLAB)
            closed_box(tb, -w_half, w_half, z_max, z_max + LAND, head_top, head_top, head_top - SLAB, head_top - SLAB)
            bmesh.ops.recalc_face_normals(tb, faces=tb.faces)  # closed solids: outward
            tme = bpy.data.meshes.new("_trim")
            tb.to_mesh(tme)
            tb.free()
            tob = bpy.data.objects.new("_trim", tme)
            sc.collection.objects.link(tob)
            bv = tob.modifiers.new("b", "BEVEL")
            bv.width = 0.07; bv.segments = 3; bv.limit_method = "ANGLE"
            bv.angle_limit = math.radians(30); bv.profile = 0.6
            dg = bpy.context.evaluated_depsgraph_get()
            ev = tob.evaluated_get(dg)
            em = ev.to_mesh()

            bm = bmesh.new()
            uvl = bm.loops.layers.uv.new("UVMap")
            add_quads(bm, uvl, steps_q, 0)
            n_before = len(bm.faces)
            bm.from_mesh(em)
            ev.to_mesh_clear()
            bpy.data.objects.remove(tob, do_unlink=True)
            bpy.data.meshes.remove(tme)
            bm.faces.ensure_lookup_table()
            for f in bm.faces[n_before:]:
                f.material_index = 1
            add_quads(bm, uvl, stone_q, 1)
            bm.normal_update()
            stone_uv(bm, uvl, [f for f in bm.faces if f.material_index == 1])
            ob = new_obj(name, bm, [m_steps, m_stone])
            shade_auto_smooth(ob, angle=35)
            xs = [v.co.x for v in ob.data.vertices]; ys = [v.co.y for v in ob.data.vertices]; zs = [v.co.z for v in ob.data.vertices]
            size = (max(xs) - min(xs), max(zs) - min(zs), max(ys) - min(ys))
            tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
            LOG.append(f"{name}: size(x,y,z)={tuple(round(v, 3) for v in size)} minY={round(min(zs), 3)} tris={tris}")
            return ob, size, min(zs)

        def preview(name, ob, n, rise, run):
            """Cycles shots under a sun + sky: from the foot looking up (SPACEY's
            reference framing) and a three-quarter view."""
            if sc.world is None:
                sc.world = bpy.data.worlds.new("W")
            sc.world.use_nodes = True
            bg = sc.world.node_tree.nodes.get("Background")
            bg.inputs["Color"].default_value = (0.55, 0.64, 0.75, 1)
            bg.inputs["Strength"].default_value = 0.55
            if "sun" not in bpy.data.objects:
                ld = bpy.data.lights.new("sun", "SUN"); ld.energy = 3.2; ld.angle = math.radians(6)
                so = bpy.data.objects.new("sun", ld); sc.collection.objects.link(so)
                so.rotation_euler = (math.radians(50), 0, math.radians(-35))
            if "ground" not in bpy.data.objects:
                gb = bmesh.new()
                for p in [(-80, -80), (80, -80), (80, 80), (-80, 80)]:
                    gb.verts.new((p[0], p[1], BASE - 0.02))
                gb.faces.new(gb.verts)
                gm = bpy.data.materials.new("ground"); gnt, gbsdf = _nodes(gm)
                gbsdf.inputs["Base Color"].default_value = (*lin(0x8e9aa0), 1)
                new_obj("ground", gb, [gm])
            sc.cycles.samples = 48
            sc.cycles.use_denoising = True
            shots = [
                ("foot", B(0, 9.5, -run / 2 - 11), B(0, rise * 0.45, 0), 50),
                ("close", B(-3.5, 3.2, -run / 2 - 3.5), B(0, 1.6, -run / 2 + 3.0), 55),
                ("quarter", B(-26, rise + 8, -run / 2 - 8), B(0, rise * 0.4, 0), 45),
            ]
            for tag, cp, tgt, fov in shots:
                cd_ = bpy.data.cameras.new("_cam"); cd_.angle = math.radians(fov); cd_.clip_end = 2000
                cam = bpy.data.objects.new("_cam", cd_); sc.collection.objects.link(cam)
                cam.location = cp
                cam.rotation_euler = (tgt - cp).to_track_quat("-Z", "Y").to_euler()
                sc.camera = cam
                sc.render.resolution_x, sc.render.resolution_y = 1400, 820
                sc.render.resolution_percentage = 100
                sc.render.image_settings.file_format = "PNG"
                sc.render.filepath = f"{OUT_DIR}/{name}_{tag}.png"
                bpy.ops.render.render(write_still=True)
                bpy.data.objects.remove(cam, do_unlink=True)
                bpy.data.cameras.remove(cd_)

        sizes = {}
        for name, (n, rise, run, RT, POST) in FLIGHTS.items():
            if ONLY and name != ONLY:
                continue
            ob, size, min_y = build_flight(name, n, rise, run, RT, POST, random.Random(zlib.crc32(name.encode())))
            sizes[name] = {"size": [round(v, 4) for v in size], "minY": round(min_y, 4), "steps": n, "rise": rise, "run": run, "rail": RT}
            if os.environ.get("EXPORT", "1") == "1":
                export_glb([ob], f"{OUT_DIR}/{name}.glb")
                LOG.append(f"exported {name}.glb")
            if PREVIEW:
                preview(name, ob, n, rise, run)
                LOG.append(f"previews {name}")
            bpy.data.objects.remove(ob, do_unlink=True)
        prev = {}
        try:
            prev = json.load(open(f"{OUT_DIR}/stair_flights.sizes.json"))
        except Exception:
            pass
        prev.update(sizes)
        json.dump(prev, open(f"{OUT_DIR}/stair_flights.sizes.json", "w"), indent=1)
        LOG.append("build stage done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
