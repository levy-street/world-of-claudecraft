# Castle B, the Warden's Keep rebuilt as a WoW-style walled keep (Troy,
# 2026-09-10: "a new castle version that looks a bit more complex like the
# castle from world of warcraft using our assets + some new ones made with
# blender ... round towers, high quality, an interior that makes sense, guards
# in the courtyard and inside"). Front faces +Y (exports to -Z), origin at
# the old keep's seat so it drops into the same crown placement.
#
# SCALE: kit units, S=1.35 (one storey = 5 kit = 6.75yd, a player 1.33 kit).
# Everything the medieval kit cannot do, round towers, blue conical roofs, a
# stone gable, is built here with bmesh and joins the same cobble bake as
# the kit walls, so old and new stone read as one masonry.
import traceback
import os

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/59e45b26-315c-4e8d-9478-c0cc7c32f012/scratchpad/bl'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    AO_BAKE = True                                   # the castle ships vertex AO
    FLOOR_PICK = lambda x, y, z: 'planks' if z > 4.0 else 'tiles'   # stone below, planks on the upper floors
    import bmesh
    import bmesh as _bm   # the exec'd helpers (cut_local_plane) look up `bmesh` in this namespace
    from mathutils import Vector as _V
    reset_build()
    M = 2.5
    S = 1.35
    PI = math.pi
    PLAYER_KIT = 1.8 / S

    # ---------------- the plan (kit) ----------------
    # Courtyard y -2..24 between the keep front and the gate wall; keep block
    # y -16..-2, x +-13; side wings x 13..25 beside the keep; bailey curtain
    # x=+-25 from the rear corner towers (y -12) to the front corners (y 24).
    KX, KY0, KY1 = 13.0, -16.0, -2.0        # keep block
    CX = 25.0                               # bailey half width (curtain line)
    CYF = 24.0                              # gate wall line
    WY0 = -12.0                             # wing rear wall line
    GATE_R, CORNER_R, FLANK_R, GREAT_R = 2.2, 2.6, 3.05, 4.0
    # The flank towers stand in the courtyard's rear corners with their PLINTH
    # (r + 0.42) ending exactly at the keep's inner face, so nothing of them is
    # inside a room, and a hand's breadth off the wing wall.
    FLANK_X = KX + 0.42 - 0.42 + FLANK_R + 0.42     # plinth edge at KX - 0.42 (the room face) -> 16.05
    FLANK_Y = KY1 + FLANK_R + 0.25
    WING_DOOR = KX + 6.0                            # 19: opening 17.6..20.4, past the flank tower's toe (17.1), clear of the stair strip (20.6+)
    # Walls are SOLID boxes now (Troy, 2026-09-10: "redo the topology so it's
    # not all these small boxes, the walls one solid optimized mesh so the
    # textures wrap cleanly; make the walls thicker"): WALL_T thick, the
    # openings cut through, kit window/arch modules kept only for their
    # frames. WALL_HALF is the face offset the brass/rune dressing uses.
    WALL_T = 1.2
    WALL_HALF = WALL_T / 2
    KC0, KC1 = KY0 - WALL_HALF, KY1 + WALL_HALF   # the keep's side walls run corner to corner
    WALL_CAP = WALL_T / 0.62                       # CastleRoof_01 (the merlon cap) is 0.62 deep
    CURTAIN_T = 1.8                                # the three courtyard walls (Troy: "a bit more thick")
    CURTAIN_HALF = CURTAIN_T / 2
    CURTAIN_H = 5.0
    KEEP_H = 15.0                           # three storeys: hall, then the Warden's floor
    WING_H = 5.0

    # ---------------- materials ----------------
    def royal_roof_material():
        """Stormwind blue: the roof atlas recoloured like roof_material(), but
        to a bright royal blue instead of storm slate."""
        name = 'CartoonTown_RoyalRoof'
        if name in bpy.data.materials:
            return bpy.data.materials[name]
        # the atlas only exists once a kit piece has been imported, and the
        # first tower's cone comes before the first wall module
        if bpy.data.materials.get('CartoonTown_01') is None:
            load_template('buildings/HouseRoof_01')
        src = bpy.data.materials.get('CartoonTown_01')
        mat = src.copy()
        mat.name = name
        node = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
        img = node.image.copy()
        img.name = 'CartoonTown_RoyalBlue'
        px = _np.array(img.pixels[:], dtype=_np.float32).reshape(-1, 4)
        rgb = px[:, :3]
        mx = rgb.max(axis=1)
        mn = rgb.min(axis=1)
        delta = mx - mn
        sat = _np.where(mx > 1e-5, delta / _np.maximum(mx, 1e-5), 0)
        r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
        hue = _np.zeros_like(mx)
        m_r = (mx == r) & (delta > 1e-5)
        m_g = (mx == g) & (delta > 1e-5) & ~m_r
        m_b = (mx == b) & (delta > 1e-5) & ~m_r & ~m_g
        hue[m_r] = ((g - b)[m_r] / delta[m_r]) % 6
        hue[m_g] = (b - r)[m_g] / delta[m_g] + 2
        hue[m_b] = (r - g)[m_b] / delta[m_b] + 4
        warm = (sat > 0.25) & ((hue < 1.4) | (hue > 5.6))
        v = _np.clip(mx * 1.02, 0, 1)
        s2 = _np.clip(sat * 1.25 + 0.15, 0, 0.9)
        h2 = 3.62   # ~217 deg: royal blue
        c = v * s2
        x2 = c * (1 - _np.abs((h2 % 2) - 1))
        m2 = v - c
        nr, ng, nb = x2 * 0 + m2, x2 + m2, c + m2
        rgb2 = rgb.copy()
        rgb2[warm, 0] = nr[warm]
        rgb2[warm, 1] = ng[warm]
        rgb2[warm, 2] = nb[warm]
        px[:, :3] = rgb2
        img.pixels.foreach_set(px.reshape(-1))
        img.pack()
        node2 = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
        node2.image = img
        return mat

    BAKED_DIR = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold'

    def baked_material(name, stem, rough=0.8):
        """A low-poly surface wearing detail baked off the kit: colour x AO
        (multiplied once, cached as <stem>_ColorAO.png) and the tangent normal
        map (Troy: "make these rounded with lower polygons and bake the detail
        on them so we don't use so many polygons")."""
        if name in bpy.data.materials:
            return bpy.data.materials[name]
        cao = f'{BAKED_DIR}/{stem}_ColorAO.png'
        if not os.path.exists(cao):
            col = bpy.data.images.load(f'{BAKED_DIR}/{stem}_Color.png')
            ao = bpy.data.images.load(f'{BAKED_DIR}/{stem}_AO.png')
            ao.colorspace_settings.name = 'Non-Color'
            c = _np.array(col.pixels[:], dtype=_np.float32).reshape(-1, 4)
            a = _np.array(ao.pixels[:], dtype=_np.float32).reshape(-1, 4)
            c[:, :3] *= (0.55 + 0.45 * a[:, :1])
            out = bpy.data.images.new(stem + '_ColorAO', col.size[0], col.size[1], alpha=False)
            out.pixels.foreach_set(c.reshape(-1))
            out.filepath_raw = cao
            out.file_format = 'PNG'
            out.save()
        img = bpy.data.images.load(cao)
        img.pack()
        nimg = bpy.data.images.load(f'{BAKED_DIR}/{stem}_Normal.png')
        nimg.colorspace_settings.name = 'Non-Color'
        nimg.pack()
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        ntex = nt.nodes.new('ShaderNodeTexImage')
        ntex.image = nimg
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = 1.0
        nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        bsdf.inputs['Roughness'].default_value = rough
        if 'Specular IOR Level' in bsdf.inputs:
            bsdf.inputs['Specular IOR Level'].default_value = 0.3
        return mat

    def spire_material():
        return baked_material('WocSpireBaked', 'Spire')

    def shingle_material():
        return baked_material('WocShingleBaked', 'Shingle')

    SH_W, SH_H = 2.53, 2.46          # the shingle patch: 11 tiles across, 6 rows up the slope (tileable)

    ROOF_UV = [None]

    def roof_tile_uv():
        """The block of the atlas the kit's roof tiles live in, found on the
        image itself: the rows and columns that are mostly warm (orange) tile
        texels. The kit's own roof polygons wrap that block, so a hand-built
        roof face mapped into it (wrapping) shows the same shingle rows."""
        if ROOF_UV[0] is None:
            if bpy.data.materials.get('CartoonTown_01') is None:
                load_template('buildings/HouseRoof_01')
            px = _atlas_pixels()['arr']   # (h, w, 4); row 0 is v = 0, as _atlas_sample reads it
            h, w = px.shape[0], px.shape[1]
            rgb = px[:, :, :3]
            mx = rgb.max(axis=2)
            mn = rgb.min(axis=2)
            d = mx - mn
            sat = _np.where(mx > 1e-5, d / _np.maximum(mx, 1e-5), 0)
            r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
            warm = (sat > 0.25) & (mx > 0.2) & (r > g) & (g >= b * 0.9) & (d > 1e-5)
            rows = warm.mean(axis=1) > 0.6
            cols = warm.mean(axis=0) > 0.6
            ys = _np.where(rows)[0]
            xs = _np.where(cols)[0]
            if len(ys) and len(xs):
                # the largest contiguous run of warm rows and of warm columns
                def run(idx):
                    best, cur = (idx[0], idx[0]), (idx[0], idx[0])
                    for i in idx[1:]:
                        if i == cur[1] + 1:
                            cur = (cur[0], i)
                        else:
                            if cur[1] - cur[0] > best[1] - best[0]:
                                best = cur
                            cur = (i, i)
                    return best if best[1] - best[0] >= cur[1] - cur[0] else cur
                y0, y1 = run(ys)
                x0, x1 = run(xs)
                ROOF_UV[0] = (x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h)
            else:
                ROOF_UV[0] = (0.0, 0.0, 0.1, 0.1)
            print('roof tile atlas block', ROOF_UV[0])
        return ROOF_UV[0]

    def _mesh_obj(name, bm, mat, grp):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        me.update()
        me.materials.append(mat)
        if not me.uv_layers:
            me.uv_layers.new()
        o = bpy.data.objects.new(name, me)
        o.parent = group(grp)
        bpy.context.scene.collection.objects.link(o)
        return o

    def _tile_uvs(me, k=0.6):
        """Roof tiles on a hand-built face: planar UVs in the tile cell,
        u along the face's horizontal run, v up its slope, k cells per kit."""
        u0, v0, u1, v1 = roof_tile_uv()
        du, dv = (u1 - u0), (v1 - v0)
        uvl = me.uv_layers.active.data
        for poly in me.polygons:
            n = poly.normal
            # a horizontal tangent for u, the slope direction for v
            t = _V((-n.y, n.x, 0.0))
            if t.length < 1e-4:
                t = _V((1, 0, 0))
            t.normalize()
            s = n.cross(t)
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uu = (co.dot(t) * k) % 1.0
                vv = (co.dot(s) * k) % 1.0
                uvl[li].uv = (u0 + du * uu, v0 + dv * vv)

    def ring_band(cx, cy, r, z0, z1, mat, grp='L0', segs=24):
        """A closed cylindrical band (the towers' brass string courses and
        stone cornices). Brass bands get world-planar UVs in the join."""
        bm = _bm.new()
        _bm.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                            radius1=r, radius2=r, depth=z1 - z0)
        _bm.ops.translate(bm, verts=bm.verts, vec=(cx, cy, (z0 + z1) / 2))
        return _mesh_obj(f'band_{len(bpy.data.meshes)}', bm, mat, grp)

    FINIAL_CUT = 14.35     # ChurchTower_03: slate cone below this local z, mast + sun-star above
    FINIAL_H = 19.358 - FINIAL_CUT

    def gold_finial(cx, cy, z_tip, h, grp='L0'):
        """The first keep's gilded spire finial (the kit spire's mast and
        sun-star, ChurchTower_03 above local z 14.35) cut off the cone and set
        on a roof point in the wall's brass. `h` is the finial's height in kit.
        Troy, 2026-09-10: "add these gold things to the top of the castle b
        roofs". The piece is not centred: its cone axis is at local y 2.4025."""
        sc = h / FINIAL_H
        o = use('buildings/ChurchTower_03', cx, cy - 2.4025 * sc, z_tip - FINIAL_CUT * sc, 0, grp, s=sc)
        cut_local_plane(o, (0, 0, FINIAL_CUT), (0, 0, 1), keep_positive=True)
        gild_spire([o], 0.0)
        return o

    SPIRE_BASE_Z, SPIRE_R = 5.9, 3.0    # ChurchTower_03: the shingled cone starts at local z 5.9 with radius 3.0
    SPIRE_H = FINIAL_CUT - SPIRE_BASE_Z + 0.55   # the cone runs 0.55 past the mast's cut plane, INTO the mast's foot (Troy: "spire crown floating again")
    FINIAL_SINK = 0.45                            # and the mast drops this much (x scale) so its foot sits in the cone

    def cone_roof(cx, cy, r, z0, h=None, grp='L0', segs=32, rings=6):
        """A tower's cone at the kit spire's pitch: a 32-segment smooth cone
        wearing the spire's shingles baked (colour x AO + tangent normal),
        the kit's gilded mast and sun-star set on its point. ~400 tris where
        the kit spire was 16k."""
        sc = r / SPIRE_R
        hh = SPIRE_H * sc
        bm = _bm.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        rows_ = []
        for k in range(rings + 1):
            t_ = k / rings
            rr = r * (1 - t_) + 0.02
            rows_.append([bm.verts.new((cx + rr * math.cos(2 * PI * i / segs), cy + rr * math.sin(2 * PI * i / segs), z0 + hh * t_)) for i in range(segs)])
        for k in range(rings):
            for i in range(segs):
                a, b = rows_[k][i], rows_[k][(i + 1) % segs]
                c, d_ = rows_[k + 1][(i + 1) % segs], rows_[k + 1][i]
                f = bm.faces.new((a, b, c, d_))
                f.smooth = True
                for lp, uv in zip(f.loops, ((i / segs, k / rings), ((i + 1) / segs, k / rings), ((i + 1) / segs, (k + 1) / rings), (i / segs, (k + 1) / rings))):
                    lp[uvl].uv = uv
        _bm.ops.recalc_face_normals(bm, faces=bm.faces)
        _mesh_obj(f'cone_{len(bpy.data.meshes)}', bm, spire_material(), grp)
        # the finial: the kit's mast and sun-star above the cone, gilded
        o = use('buildings/ChurchTower_03', cx, cy - 2.4025 * sc, z0 - (SPIRE_BASE_Z + FINIAL_SINK) * sc, 0, grp, s=sc)
        cut_local_plane(o, (0, 0, FINIAL_CUT), (0, 0, 1), keep_positive=True)
        gild_spire([o], 0.0)
        return o

    def round_tower(cx, cy, r, h, cone_h, grp='L0', merlons=12, rings=(), slits=True,
                    runes=True, sigil_z=None, cone=True, facets=(0.0, PI / 2, PI, -PI / 2)):
        """A round Warden tower: straight cobble drum on a flared plinth, brass
        string courses, a corbelled cornice under a crenellated parapet, arrow
        slits, the Warden rune conduits on four facets, and a blue cone. Two
        collision boxes (an octagon), every hand-built tower costs the same."""
        # drum + plinth
        bm = _bm.new()
        _bm.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24,
                            radius1=r, radius2=r, depth=h)
        _bm.ops.translate(bm, verts=bm.verts, vec=(cx, cy, h / 2))
        drum = _mesh_obj(f'tower_{len(bpy.data.meshes)}', bm, cobble_material(), grp)
        bm = _bm.new()
        _bm.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24,
                            radius1=r + 0.42, radius2=r + 0.06, depth=1.3)
        _bm.ops.translate(bm, verts=bm.verts, vec=(cx, cy, 0.65))
        _mesh_obj(f'plinth_{len(bpy.data.meshes)}', bm, cobble_material(), grp)
        # string courses
        for z in rings:
            ring_band(cx, cy, r + 0.10, z - 0.08, z + 0.08, brass_material(), grp)
        # cornice: two corbel steps, then the parapet ring and its merlons
        ring_band(cx, cy, r + 0.18, h - 0.55, h - 0.28, cobble_material(), grp)
        ring_band(cx, cy, r + 0.36, h - 0.28, h + 0.05, cobble_material(), grp)
        ring_band(cx, cy, r + 0.36, h + 0.05, h + 0.55, cobble_material(), grp)
        for k in range(merlons):
            a = (k + 0.5) / merlons * 2 * PI
            mx_, my_ = cx + math.cos(a) * (r + 0.18), cy + math.sin(a) * (r + 0.18)
            _solid_box(mx_, my_, h + 0.55, 0.30, 0.19, 0.30, cobble_material(), grp, a)
        # brass rail on the parapet lip
        ring_band(cx, cy, r + 0.40, h + 0.55, h + 0.62, brass_material(), grp)
        # arrow slits: dark iron, on the facets between the rune posts
        if slits:
            for k in range(4):
                a = k * PI / 2 + PI / 4
                nx_, ny_ = math.cos(a), math.sin(a)
                for zc in (h * 0.36, h * 0.72):
                    if zc > h - 1.0:
                        continue
                    _solid_box(cx + nx_ * (r + 0.02), cy + ny_ * (r + 0.02), zc,
                               0.10, 0.045, 0.42, iron_material(), grp, a)
        # the Warden tower's vertical rune conduits, broken at every string course
        if runes:
            spans, z0 = [], 1.5
            for z in sorted(rings) + [h - 0.9]:
                if z - 0.45 > z0 + 0.6:
                    spans.append((z0, z - 0.45))
                z0 = z + 0.45
            for a in facets:
                nx_, ny_ = math.cos(a), math.sin(a)
                rune_post(cx + nx_ * r, cy + ny_ * r, nx_, ny_, spans,
                          sigil_z if sigil_z else (spans[-1][0] + spans[-1][1]) / 2, face=0.0)
        if cone:
            ring_band(cx, cy, r + 0.55, h + 0.62, h + 0.72, dark_solid_material(), grp)
            cone_roof(cx, cy, r + 0.60, h + 0.72, cone_h, grp)
        # collision: an octagon of two boxes
        a8 = r * 0.924
        col(cx, cy, h / 2, a8, a8, h / 2, 0.0)
        col(cx, cy, h / 2, a8, a8, h / 2, PI / 4)
        return drum

    def stone_gable(xc, ym, z_eave, z_ridge, half_span, grp='L0', thick=0.84):
        """A triangular stone gable in the y-z plane at x = xc (the end of a
        ridge that runs along x), apex at z_ridge over ym, in the walls' cobble."""
        bm = _bm.new()
        pts = [(ym - half_span, z_eave), (ym + half_span, z_eave), (ym, z_ridge)]
        verts = []
        for dx in (-thick / 2, thick / 2):
            for (py_, pz) in pts:
                verts.append(bm.verts.new((xc + dx, py_, pz)))
        bm.faces.new((verts[0], verts[1], verts[2]))
        bm.faces.new((verts[5], verts[4], verts[3]))
        for i, j in ((0, 1), (1, 2), (2, 0)):
            bm.faces.new((verts[i], verts[j], verts[j + 3], verts[i + 3]))
        _bm.ops.recalc_face_normals(bm, faces=bm.faces)
        return _mesh_obj(f'gable_{len(bpy.data.meshes)}', bm, cobble_material(), grp)

    def _slope_rows(bm, xa, xb, ye, yr, z_eave, z_ridge, rows=9, lip=0.09, thick=0.2):
        """One roof slope as stepped shingle rows from the eave (ye) to the
        ridge (yr): each row a slab along x whose lower edge lips over the row
        beneath it, which is what gives a tiled roof its lines."""
        for i in range(rows):
            t0, t1 = i / rows, (i + 1) / rows
            ya_, yb_ = ye + (yr - ye) * t0, ye + (yr - ye) * t1
            za_, zb_ = z_eave + (z_ridge - z_eave) * t0, z_eave + (z_ridge - z_eave) * t1
            d = 1 if yr > ye else -1
            # the row's lower edge overhangs by `lip` toward the eave side
            ya_l = ya_ - d * (lip if i > 0 else 0.0)
            za_l = za_ - (z_ridge - z_eave) / (abs(yr - ye) + 1e-6) * (lip if i > 0 else 0.0)
            v = [bm.verts.new(p) for p in (
                (xa, ya_l, za_l + thick * 0.5), (xb, ya_l, za_l + thick * 0.5), (xb, yb_, zb_ + thick * 0.5), (xa, yb_, zb_ + thick * 0.5),
                (xa, ya_l, za_l - thick * 0.5), (xb, ya_l, za_l - thick * 0.5), (xb, yb_, zb_ - thick * 0.5), (xa, yb_, zb_ - thick * 0.5))]
            bm.faces.new((v[0], v[1], v[2], v[3]))
            bm.faces.new((v[7], v[6], v[5], v[4]))
            bm.faces.new((v[0], v[4], v[5], v[1]))
            bm.faces.new((v[1], v[5], v[6], v[2]))
            bm.faces.new((v[3], v[2], v[6], v[7]))
            bm.faces.new((v[0], v[3], v[7], v[4]))

    def lean_gable(x_hi, x_lo, y, z_base, z_hi, z_lo, grp='L0', thick=0.84):
        """The stone wedge that closes a lean-to's end: wall top z_base along
        [x_hi, x_lo], the roof line from z_hi (at the keep) to z_lo (at the
        curtain) above it, in the walls' cobble."""
        bm = _bm.new()
        pts = [(x_hi, z_base), (x_lo, z_base), (x_lo, z_lo), (x_hi, z_hi)]
        verts = []
        for dy in (-thick / 2, thick / 2):
            for (px_, pz) in pts:
                verts.append(bm.verts.new((px_, y + dy, pz)))
        bm.faces.new((verts[0], verts[1], verts[2], verts[3]))
        bm.faces.new((verts[7], verts[6], verts[5], verts[4]))
        for i, j in ((0, 1), (1, 2), (2, 3), (3, 0)):
            bm.faces.new((verts[i], verts[j], verts[j + 4], verts[i + 4]))
        _bm.ops.recalc_face_normals(bm, faces=bm.faces)
        return _mesh_obj(f'lgable_{len(bpy.data.meshes)}', bm, cobble_material(), grp)

    ROOF_EAVE_Z, ROOF_HALF_D, ROOF_RISE, ROOF_LEN = 3.8, 4.28, 4.57, 11.0   # HouseRoof_05: eave, half depth, rise, length

    def _slab(bm, uvl, P0, U, V, N, w, L, thick, u_k, v_k, v_off=0.0):
        """One roof slope as a slab: top quad at P0 (bottom-centre) spanning
        w across U and L up V, thickness `thick` under it. Planar UVs on the
        top in the shingle patch's period (u across, v up the slope)."""
        top = [P0 + U * (-w / 2), P0 + U * (w / 2), P0 + U * (w / 2) + V * L, P0 + U * (-w / 2) + V * L]
        vt = [bm.verts.new(p) for p in top]
        vb = [bm.verts.new(p - N * thick) for p in top]
        f = bm.faces.new(vt)
        for lp, (uu, vv) in zip(f.loops, ((-w / 2, 0), (w / 2, 0), (w / 2, L), (-w / 2, L))):
            lp[uvl].uv = (uu * u_k, vv * v_k + v_off)
        bm.faces.new(list(reversed(vb)))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((vt[i], vb[i], vb[j], vt[j]))

    def tile_roof(x0, x1, y0, y1, z_eave, grp='H2', overhang=0.5, thick=0.22):
        """The keep's gable roof: two slope slabs meeting at the ridge in ONE
        mesh (no join, no gap), at the kit's 47-degree pitch, wearing the
        shingle patch baked off HouseRoof_05. Returns the ridge height."""
        ym = (y0 + y1) / 2
        half = (y1 - y0) / 2 + overhang
        ridge = z_eave + half * (ROOF_RISE / ROOF_HALF_D)
        L = math.hypot(half, ridge - z_eave)
        w = (x1 - x0) + 2 * overhang
        bm = _bm.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        for sgn in (-1, 1):
            P0 = _V(((x0 + x1) / 2, ym + sgn * half, z_eave))
            V = _V((0, -sgn * half / L, (ridge - z_eave) / L))
            N = _V((0, sgn * (ridge - z_eave) / L, half / L))
            _slab(bm, uvl, P0, _V((1, 0, 0)), V, N, w, L, thick, 1.0 / SH_W, 1.0 / SH_H)
        _bm.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        _bm.ops.recalc_face_normals(bm, faces=bm.faces)
        _mesh_obj(f'roof_{len(bpy.data.meshes)}', bm, shingle_material(), grp)
        _solid_box((x0 + x1) / 2, ym, ridge + 0.08, w / 2, 0.24, 0.12, dark_solid_material(), grp)   # the ridge cap
        return ridge

    def lean_roof(x_hi, x_lo, y0, y1, z_hi, z_lo, grp='H2', overhang=0.4, thick=0.22):
        """A lean-to from the keep wall (x_hi, high) down to the curtain
        (x_lo, low): one slab on the baked shingle."""
        s = 1 if x_lo > x_hi else -1
        xl = x_lo + s * overhang
        ya, yb = y0 - overhang, y1 + overhang
        run = abs(x_hi - xl)
        rise = z_hi - z_lo
        L = math.hypot(run, rise)
        V = _V((-s * run / L, 0, rise / L))
        N = _V((s * rise / L, 0, run / L))
        P0 = _V((xl, (ya + yb) / 2, z_lo))
        bm = _bm.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        _slab(bm, uvl, P0, _V((0, 1, 0)), V, N, yb - ya, L, thick, 1.0 / SH_W, 1.0 / SH_H)
        _bm.ops.recalc_face_normals(bm, faces=bm.faces)
        return _mesh_obj(f'lean_{len(bpy.data.meshes)}', bm, shingle_material(), grp)

    # ---------------- solid walls ----------------
    OPENING = {                     # kind: (half width, sill, spring, apex) in kit, from the kit modules' own openings
        'w04': (0.43, 1.05, 3.55, 4.05),
        'w05': (0.43, 1.05, 2.50, 2.95),
        'arch': (1.00, 0.05, 1.85, 2.80),
        'gate': (1.50, 0.05, 2.80, 4.20),
    }
    FRAME = {'w04': ('buildings/CastleWall_04', 1.0), 'w05': ('buildings/CastleWall_05', 1.0),
             'arch': ('buildings/CastleWall_06', 1.0), 'gate': ('buildings/CastleWall_06', 1.5)}

    def _opening_profile(kind):
        hw, zb, zs, za = OPENING[kind]
        pts = [(-hw, zb), (hw, zb), (hw, zs)]
        for k in range(1, 8):
            t_ = k / 8
            pts.append((hw * math.cos(t_ * PI / 2), zs + (za - zs) * math.sin(t_ * PI / 2)))
        pts.append((0.0, za))
        for k in range(7, 0, -1):
            t_ = k / 8
            pts.append((-hw * math.cos(t_ * PI / 2), zs + (za - zs) * math.sin(t_ * PI / 2)))
        pts.append((-hw, zs))
        return pts

    def strip_stone(o):
        """A kit window/arch module reduced to its frame: every face the
        loader dressed in the cobble (the module's wall) is deleted."""
        o.data = o.data.copy()
        me = o.data
        cm = cobble_material()
        kill = [p.index for p in me.polygons if me.materials and me.materials[p.material_index] is cm]
        if not kill:
            return
        bm = _bm.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        _bm.ops.delete(bm, geom=[bm.faces[i] for i in kill], context='FACES')
        bm.to_mesh(me)
        bm.free()
        me.update()

    def solid_wall(x0, y0, x1, y1, z0, z1, openings=(), grp='L0', t=WALL_T, cap=False, grid=1.25):
        """ONE stone box along (x0,y0)->(x1,y1), z0..z1, `t` thick, tessellated
        into a `grid` for the weathering and AO to live on, with every opening
        (px, py, zb, kind) cut clean through (exact boolean) and the kit
        module's frame set into both faces of the cut. World-planar stone UVs
        come with the cobble (the join maps them continuously, no per-module
        flips, which were the seams). `cap` lays the merlon cap along the top.
        Returns the run's cells for dress_cells."""
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        ux, uy = dx / L, dy / L
        nx, ny = -uy, ux
        ang = math.atan2(dy, dx)
        W = lambda s_, n_, z_: (x0 + ux * s_ + nx * n_, y0 + uy * s_ + ny * n_, z_)
        bm = _bm.new()
        _bm.ops.create_cube(bm, size=1.0)
        _bm.ops.scale(bm, vec=(L, t, z1 - z0), verts=bm.verts)
        _bm.ops.translate(bm, vec=(L / 2, 0, (z0 + z1) / 2), verts=bm.verts)
        # the grid: bisect along the run and up the height
        k = grid
        while k < L - 0.3:
            _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(k, 0, 0), plane_no=(1, 0, 0))
            k += grid
        k = z0 + grid
        while k < z1 - 0.3:
            _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, k), plane_no=(0, 0, 1))
            k += grid
        # cuts near the ends and at every storey line, so the corners' AO has
        # vertices to fall off in (Troy: "AO in the corners so the rooms have
        # more depth"), a few hundred verts, no runtime cost
        for sk in (0.35, 0.9, L - 0.9, L - 0.35):
            if 0.05 < sk < L - 0.05:
                _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(sk, 0, 0), plane_no=(1, 0, 0))
        for zl in [z0, z1] + [zz for zz in (5.0, 10.0) if z0 + 0.5 < zz < z1 - 0.5]:
            for zk in (zl - 0.9, zl - 0.35, zl + 0.35, zl + 0.9):
                if z0 + 0.05 < zk < z1 - 0.05:
                    _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, zk), plane_no=(0, 0, 1))
        # rings of cuts round every opening, so the baked vertex AO has
        # vertices where the reveal's shadow lives (Troy: "baked shadows in
        # the doorways and window archways")
        for (px_, py_, zb, kind) in openings:
            sc_ = (px_ - x0) * ux + (py_ - y0) * uy
            hw_, _zb, _zs, za = OPENING[kind]
            for d_ in (0.25, 0.7):
                for sk in (sc_ - hw_ - d_, sc_ + hw_ + d_):
                    if 0.1 < sk < L - 0.1:
                        _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(sk, 0, 0), plane_no=(1, 0, 0))
                for zk in (zb + _zb - d_, zb + za + d_):
                    if z0 + 0.1 < zk < z1 - 0.1:
                        _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, zk), plane_no=(0, 0, 1))
            for nk in (-t / 2 + 0.3, t / 2 - 0.3):     # and through the thickness, so the reveal faces get their own vertices
                _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, nk, 0), plane_no=(0, 1, 0))
        # into world
        for v in bm.verts:
            v.co = _V(W(v.co.x, v.co.y, v.co.z))
        _bm.ops.recalc_face_normals(bm, faces=bm.faces)
        wall = _mesh_obj(f'wall_{len(bpy.data.meshes)}', bm, cobble_material(), grp)
        cells_n = max(1, int(math.ceil(L / M - 1e-6)))
        cw = L / cells_n
        cells = [(W((i + 0.5) * cw, 0, 0)[0], W((i + 0.5) * cw, 0, 0)[1], cw, 'buildings/CastleWall_01') for i in range(cells_n)]
        if openings:
            cb = _bm.new()
            for (px_, py_, zb, kind) in openings:
                sc_ = (px_ - x0) * ux + (py_ - y0) * uy
                prof = _opening_profile(kind)
                face = cb.faces.new([cb.verts.new(W(sc_ + a, -t / 2 - 0.2, zb + b)) for (a, b) in prof])
                ext = _bm.ops.extrude_face_region(cb, geom=[face])
                vs = [g for g in ext['geom'] if isinstance(g, _bm.types.BMVert)]
                _bm.ops.translate(cb, vec=(nx * (t + 0.4), ny * (t + 0.4), 0), verts=vs)
                # every cell this opening touches is a window cell (no conduit)
                if zb < z0 + 4.0:
                    hw_ = OPENING[kind][0] + 0.15
                    for ci in range(cells_n):
                        if (ci + 1) * cw > sc_ - hw_ and ci * cw < sc_ + hw_:
                            cells[ci] = (cells[ci][0], cells[ci][1], cells[ci][2], 'buildings/CastleWall_04')
                # the frame on both faces: the module's half depth is 0.16
                piece, fs = FRAME[kind]
                for side in (1, -1):
                    fx, fy, fz = W(sc_, side * (t / 2 - 0.16 * fs), zb)
                    fo = use(piece, fx, fy, fz, ang + (0 if side > 0 else PI), grp, s=fs)
                    strip_stone(fo)
            _bm.ops.recalc_face_normals(cb, faces=cb.faces)
            cutter = _mesh_obj(f'cut_{len(bpy.data.meshes)}', cb, cobble_material(), grp)
            mod = wall.modifiers.new('cut', 'BOOLEAN')
            mod.operation = 'DIFFERENCE'
            mod.solver = 'EXACT'
            mod.object = cutter
            bpy.context.view_layer.update()
            dg_ = bpy.context.evaluated_depsgraph_get()
            me2 = bpy.data.meshes.new_from_object(wall.evaluated_get(dg_))
            wall.modifiers.clear()
            old = wall.data
            wall.data = me2
            bpy.data.meshes.remove(old)
            bpy.data.objects.remove(cutter, do_unlink=True)
            if not wall.data.materials:
                wall.data.materials.append(cobble_material())
            if not wall.data.uv_layers:
                wall.data.uv_layers.new()
        if cap:
            for i in range(cells_n):
                cx_, cy_, _z = W((i + 0.5) * cw, 0, 0)
                use('buildings/CastleRoof_01', cx_, cy_, z1 + 0.85, ang, grp, sx=cw / M, sy=t / 0.62)
        return dict(cells=cells, ang=ang, ux=ux, uy=uy, nx=nx, ny=ny)

    def cells_along(x0, y0, x1, y1):
        """The 2.5-pitch cell centres along a run (squeezed to fit)."""
        L = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(math.ceil(L / M - 1e-6)))
        w = L / n
        return [(x0 + (x1 - x0) * (i + 0.5) / n, y0 + (y1 - y0) * (i + 0.5) / n) for i in range(n)], w

    def dress_cells(run, z, faces, grp='L0'):
        """The rune conduit laid cell by cell, only on PLAIN modules: a window
        fills nearly the whole module (0.36..4.99), so a conduit at any height
        would cross it (Troy: "these glowing bits are overlapping the
        windows"). `faces` are signed face offsets along the run's left normal."""
        mat = rune_material()
        for (cx_, cy_, w, piece) in run['cells']:
            if not piece.endswith(('CastleWall_01', 'CastleWall_07')):
                continue
            for face in faces:
                sgn = 1.0 if face >= 0 else -1.0
                tube = face + sgn * (RUNE_PROUD - RUNE_T / 2)
                sig = face + sgn * (SIGIL_PROUD - SIGIL_HALF_T)
                for (a, b) in ((-w / 2 + RUNE_END, -RUNE_GAP), (RUNE_GAP, w / 2 - RUNE_END)):
                    if b - a < 0.25:
                        continue
                    m = (a + b) / 2
                    _solid_box(cx_ + run['ux'] * m + run['nx'] * tube, cy_ + run['uy'] * m + run['ny'] * tube, z,
                               (b - a) / 2, RUNE_T / 2, RUNE_T / 2, mat, grp, run['ang'])
                _rune_diamond(cx_ + run['nx'] * sig, cy_ + run['ny'] * sig, z, run['ang'], grp)

    def brazier(x, y, z=0.0, grp='L0', collide=True):
        stone_slab(x, y, z, 0.22, 0.22, 0.34, grp)
        use('props/Fire_01', x, y, z + 0.68, 0, grp, s=1.35)
        if collide:
            col(x, y, z + 0.45, 0.3, 0.3, 0.45)

    def flat_steps(x, y_front, width, treads, top_z, depth=0.42, grp='L0', rz=0.0):
        """Steps descending along local +y (rotated rz) from a platform face."""
        rise = top_z / treads
        c, s_ = math.cos(rz), math.sin(rz)
        for i in range(treads):
            top = top_z - i * rise
            d = depth * (i + 0.5)
            px_, py_ = x - s_ * d, y_front + c * d
            use('buildings/Floor_01', px_, py_, top - 0.1, rz, grp, sx=width / 2.5, sy=(depth + 0.06) / 2.5)
            mass = max(0.02, top - 0.2)
            stone_slab(px_, py_, 0.0, width / 2, (depth + 0.06) / 2, mass / 2, grp) if abs(rz) < 1e-6 else \
                _solid_box(px_, py_, mass / 2, width / 2, (depth + 0.06) / 2, mass / 2, slab_material(), grp, rz)
        run = treads * depth
        ramp(x - s_ * run / 2, y_front + c * run / 2, run / 2 + 0.1, width / 2, PI / 2 + rz, top_z, 0.0)

    def stone_stair(x0, x1, y_lo, y_hi, z_lo, z_hi, treads, grp):
        d = (y_hi - y_lo) / treads
        rise = (z_hi - z_lo) / treads
        w = x1 - x0
        for i in range(treads):
            top = z_lo + (i + 1) * rise
            cx_, cy_ = (x0 + x1) / 2, y_lo + (i + 0.5) * d
            use('buildings/Floor_01', cx_, cy_, top - 0.1, 0, grp, sx=w / 2.5, sy=(abs(d) + 0.06) / 2.5)
            mass = max(0.02, (top - 0.2) - z_lo)
            stone_slab(cx_, cy_, z_lo, w / 2, (abs(d) + 0.06) / 2, mass / 2, grp)
        # The deck is padded 0.15 at the FOOT only. Padded at the head too, the
        # summit z_hi sat 0.15 past the landing's edge and the flight was still
        # 0.15 kit short of it where the landing box begins, a box top above
        # the treads, which a grounded mover never steps UP onto. Ending the
        # deck exactly at y_hi puts z_hi on the landing's edge, and the landing
        # box tops 0.02 under it.
        sgn = 1 if y_hi > y_lo else -1
        ramp((x0 + x1) / 2, (y_lo - sgn * 0.15 + y_hi) / 2, (abs(y_hi - y_lo) + 0.15) / 2, w / 2,
             PI / 2 if y_hi > y_lo else -PI / 2, z_lo, z_hi)

    def ceiling(x0, x1, y0, y1, z_top, skip=None, grp='L0'):
        """A plank ceiling under an upper floor, ALWAYS visible (the walkable
        tiles above it live in a reveal group and hide): slabs round the
        stairwell `skip` = (x0, x1, y0, y1), joists across. Its top sits 0.1
        under the tiles' walking surface."""
        xa, xb = min(x0, x1), max(x0, x1)
        ya, yb = min(y0, y1), max(y0, y1)
        mat = floor_material('planks')
        parts = [(xa, xb, ya, yb)]
        if skip:
            sx0, sx1, sy0, sy1 = min(skip[0], skip[1]), max(skip[0], skip[1]), min(skip[2], skip[3]), max(skip[2], skip[3])
            parts = [(xa, min(xb, sx0), ya, yb), (max(xa, sx1), xb, ya, yb),
                     (max(xa, sx0), min(xb, sx1), ya, min(yb, sy0)), (max(xa, sx0), min(xb, sx1), max(ya, sy1), yb)]
        for (px0, px1, py0, py1) in parts:
            if px1 - px0 > 0.2 and py1 - py0 > 0.2:
                o = _solid_box((px0 + px1) / 2, (py0 + py1) / 2, z_top - 0.16, (px1 - px0) / 2, (py1 - py0) / 2, 0.06, mat, grp)
                bm = _bm.new()
                bm.from_mesh(o.data)
                for k in [px0 + 0.4, px0 + 1.0] + [px1 - 1.0, px1 - 0.4] + [px0 + 1.25 * i for i in range(2, int((px1 - px0) / 1.25))]:
                    if px0 + 0.05 < k < px1 - 0.05:
                        _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(k, 0, 0), plane_no=(1, 0, 0))
                for k in [py0 + 0.4, py0 + 1.0] + [py1 - 1.0, py1 - 0.4] + [py0 + 1.25 * i for i in range(2, int((py1 - py0) / 1.25))]:
                    if py0 + 0.05 < k < py1 - 0.05:
                        _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, k, 0), plane_no=(0, 1, 0))
                bm.to_mesh(o.data)
                bm.free()
        n = max(2, int((xb - xa) / 2.5))
        for k in range(n):
            jx = xa + (xb - xa) * (k + 0.5) / n
            _solid_box(jx, (ya + yb) / 2, z_top - 0.36, 0.14, (yb - ya) / 2, 0.14, dark_solid_material(), grp)

    # ================= TOWERS =================
    # The great tower stands against the keep's back wall; the flank towers in
    # the courtyard's rear corners, engaged into the keep and the wings; every
    # tower's rune posts go only on the facets that face open air.
    round_tower(0, KY0 - GREAT_R - 0.2, GREAT_R, 25.0, 8.0, rings=(5.0, 10.0, 15.0, 20.0),
                facets=(PI, -PI / 2, 0.0))                                                  # rear + sides
    for sx in (-1, 1):
        round_tower(sx * FLANK_X, FLANK_Y, FLANK_R, 19.0, 6.0, rings=(5.0, 10.0, 15.0),
                    facets=(PI / 2, 0.0 if sx > 0 else PI))                                # courtyard faces
        round_tower(sx * CX, CYF, CORNER_R, 8.0, 4.0, rings=(5.0,),
                    facets=(PI / 2, 0.0 if sx > 0 else PI))                                # front corners: out
        round_tower(sx * CX, WY0, CORNER_R, 12.0, 4.5, rings=(5.0, 10.0),
                    facets=(-PI / 2, 0.0 if sx > 0 else PI))                               # rear corners: out, over the wings
        round_tower(sx * (2.5 + GATE_R), CYF, GATE_R, 9.0, 4.5, rings=(5.0,),
                    facets=(PI / 2, -PI / 2))                                              # gate pair: front + back

    # ================= CURTAIN (L0) =================
    GATE_HW = OPENING['gate'][0]
    GATE_H = 6.5                                     # the gatehouse block between the gate towers
    for sx in (-1, 1):
        # front wall from the gate tower to the corner tower
        solid_wall(sx * (2.5 + 2 * GATE_R), CYF, sx * (CX - CORNER_R), CYF, 0, CURTAIN_H, cap=True, t=CURTAIN_T)
        # side wall: two storeys along the wing (its outer wall, windowed
        # upstairs), one storey beyond it, both capped
        side_cells, _w = cells_along(sx * CX, WY0 + CORNER_R, sx * CX, KY1 + WALL_HALF)
        solid_wall(sx * CX, WY0 + CORNER_R, sx * CX, KY1 + WALL_HALF, 0, 2 * WING_H,
                   openings=[(cx_, cy_, WING_H, 'w04') for k, (cx_, cy_) in enumerate(side_cells) if k % 2 == 0], cap=True, t=CURTAIN_T)
        solid_wall(sx * CX, KY1 + WALL_HALF, sx * CX, CYF - CORNER_R, 0, CURTAIN_H, cap=True, t=CURTAIN_T)
        # rear return = the wing's rear wall: two storeys, capped; windows
        # upstairs clear of the rear corner tower's drum (x 22.4..25)
        rear_cells, _w = cells_along(sx * (KX + WALL_HALF), WY0, sx * (CX - CORNER_R), WY0)
        solid_wall(sx * (KX + WALL_HALF), WY0, sx * (CX - CORNER_R), WY0, 0, 2 * WING_H,
                   openings=[(cx_, cy_, WING_H, 'w04') for k, (cx_, cy_) in enumerate(rear_cells) if k % 2 == 1 and abs(cx_) < CX - CORNER_R - 1.0], cap=True)
    # the gate: a gatehouse block with a wide arch between the gate towers,
    # portcullis behind it, the machicolation over it
    solid_wall(-(2.5 + GATE_R), CYF, 2.5 + GATE_R, CYF, 0, GATE_H, openings=[(0, CYF, 0.0, 'gate')], cap=True, t=CURTAIN_T)
    gate = use('environment/WallGate_01', 0, CYF - 0.55, 3.0, 0, 'L0', s=1.05 * GATE_HW / 1.0)   # raised: its spikes clear a head
    use('buildings/CastleBalcony_01', 0, CYF + CURTAIN_HALF + 0.02, GATE_H + 1.0, 0, 'L0', s=0.98)   # machicolation over the gate
    for sx in (-1, 1):
        use('props/Flag_02', sx * 3.4, CYF + CURTAIN_HALF + 0.35, 4.6, PI, 'L0', s=1.2)
    # the gate passage: ONE shallow ramp from the courtyard deck's edge (y 21.5)
    # down to the ground outside (25.4), it replaced the threshold-step ramp
    # and the passage deck to pay for the keep's L-stair; tiles through it
    # one tile that fits INSIDE the arch (x +-1.45, y 23.75..25.4): a slab whose
    # corners sit inside the gatehouse's solid wall bakes its vertex AO black
    use('environment/Tile_01', 0, 24.575, 0.0, 0, 'L0', sx=1.16, sy=0.66)
    ramp(0, (21.5 + 25.4) / 2, (25.4 - 21.5) / 2, 2.2, -PI / 2, 0.166, -0.02)

    # ================= WALL WALK =================
    # Troy: "attach a walkway with some steps leading up to it along the
    # walls". A stone allure on corbels along the inside of the three
    # courtyard walls, 1.2 under the wall head (the wall above it is the
    # breastwork, the merlons above that), reached by a flight along each
    # wall. Each walk is a BOX topping 0.02 under its flight's summit; the
    # flights are ramps. Budget: the door lintels (unreachable by a jump) and
    # the rear braziers gave up their boxes, the door-threshold decks and the
    # stair nook their ramps.
    WALK_Z, WALK_W = CURTAIN_H - 1.2, 1.5
    XI = CX - CURTAIN_HALF                      # the side curtains' inner face
    YI = CYF - CURTAIN_HALF                     # the gate wall's inner face

    def walk_slab(x0, x1, y0, y1, along, grp='L0'):
        cx_, cy_ = (x0 + x1) / 2, (y0 + y1) / 2
        hx_, hy_ = abs(x1 - x0) / 2, abs(y1 - y0) / 2
        stone_slab(cx_, cy_, WALK_Z - 0.3, hx_, hy_, 0.15, grp)
        col(cx_, cy_, WALK_Z - 0.06, hx_, hy_, 0.06)
        # corbels under the slab against the wall, a rail along the open edge
        n = max(1, int(round((2 * (hx_ if along == 'x' else hy_)) / 2.5)))
        for i in range(n):
            t_ = (i + 0.5) / n
            if along == 'y':
                wx = x0 if abs(x0) > abs(x1) else x1      # the wall side
                stone_slab(wx - (0.3 if wx > 0 else -0.3), y0 + (y1 - y0) * t_, WALK_Z - 0.85, 0.28, 0.3, 0.28, grp)
            else:
                stone_slab(x0 + (x1 - x0) * t_, y1 - 0.3, WALK_Z - 0.85, 0.3, 0.28, 0.28, grp)
        if along == 'y':
            ex = x0 if abs(x0) < abs(x1) else x1          # the courtyard edge
            k = 0
            while (k + 1) * 1.24 <= abs(y1 - y0) + 0.05:
                use('buildings/CastleFence_01', ex + (0.08 if ex < 0 else -0.08), min(y0, y1) + 0.62 + k * 1.24, WALK_Z, PI / 2, grp)
                k += 1
        else:
            k = 0
            while (k + 1) * 1.24 <= abs(x1 - x0) + 0.05:
                use('buildings/CastleFence_01', min(x0, x1) + 0.62 + k * 1.24, y0 + 0.08, WALK_Z, 0, grp)
                k += 1

    def stone_stair_x(x_lo, x_hi, y0, y1, z_lo, z_hi, treads, grp='L0'):
        """stone_stair turned along x: from x_lo (z_lo) to x_hi (z_hi)."""
        d = (x_hi - x_lo) / treads
        rise = (z_hi - z_lo) / treads
        w = y1 - y0
        cy_ = (y0 + y1) / 2
        for i in range(treads):
            top = z_lo + (i + 1) * rise
            cx_ = x_lo + (i + 0.5) * d
            use('buildings/Floor_01', cx_, cy_, top - 0.1, 0, grp, sx=(abs(d) + 0.06) / 2.5, sy=w / 2.5)
            mass = max(0.02, (top - 0.2) - z_lo)
            stone_slab(cx_, cy_, z_lo, (abs(d) + 0.06) / 2, w / 2, mass / 2, grp)
        sgn = 1 if x_hi > x_lo else -1
        ramp((x_lo - sgn * 0.15 + x_hi) / 2, cy_, (abs(x_hi - x_lo) + 0.15) / 2, w / 2, 0.0 if sgn > 0 else PI, z_lo, z_hi)

    for sx in (-1, 1):
        # the side curtain: a flight from y 2 up to y 8, the walk on to the corner tower
        xa, xb = sx * (XI - WALK_W), sx * XI
        stone_stair(min(xa, xb), max(xa, xb), 2.0, 8.0, 0.2, WALK_Z + 0.02, 10, 'L0')
        walk_slab(xa, xb, 8.0, CYF - CORNER_R, 'y')
        # the gate wall: a flight from x 8 out to x 14, the walk on to the corner tower
        stone_stair_x(sx * 8.0, sx * 14.0, YI - WALK_W, YI, 0.2, WALK_Z + 0.02, 10, 'L0')
        walk_slab(sx * 14.0, sx * (CX - CORNER_R), YI - WALK_W, YI, 'x')

    # ================= KEEP (L0 walls, three storeys, one box a side) =================
    # front: the great door, the balcony door over it; windows only where the
    # hall is open behind them (the Warden's stair stands behind the two west
    # cells, a pillar behind the fourth, Troy: "some of the windows are
    # blocked up"); storey windows over the same bays
    KF_X = (3.55, 7.75)
    front_open = [(0, KY1, 0.0, 'arch'), (0, KY1, 10.0, 'arch')]
    for sx in (-1, 1):
        for wx in KF_X:
            front_open.append((sx * wx, KY1, 0.0, 'w04'))
            front_open.append((sx * wx, KY1, 10.0, 'w05'))
        for wx in (3.55, 7.75, 11.5):
            front_open.append((sx * wx, KY1, 5.0, 'w05'))
    KF = solid_wall(-KX + WALL_HALF, KY1, KX - WALL_HALF, KY1, 0, KEEP_H, openings=front_open)   # the side boxes own the corners
    use('buildings/CastleDoor_02', -0.95, KY1 - WALL_HALF + 0.12, 0, -2.0, 'L0')
    use('buildings/CastleDoor_03', 0.95, KY1 - WALL_HALF + 0.12, 0, 2.0, 'L0')
    # the Warden's balcony: its floor (1.8 x 0.9 under its origin) level with the third storey
    # rz=PI: the kit balcony's depth runs to local -y, so at rz=0 it stood
    # INSIDE the wall with only its back showing (Troy: "the overhang is
    # facing the wrong way"); turned round it hangs out over the courtyard.
    use('buildings/CastleBalcony_01', 0, KY1 + WALL_HALF + 0.02, 10.0 + 1.62, PI, 'L0', s=0.9)
    col(0, KY1 + WALL_HALF + 1.2, 10.06 - 0.05, 2.2, 1.15, 0.05)          # the balcony floor, a step under the room's
    col_wall(-2.2, KY1 + WALL_HALF + 2.3, 2.2, KY1 + WALL_HALF + 2.3, 10.0, 11.0, 0.12)   # its parapet
    for sx in (-1, 1):
        use('props/Flag_04', sx * 5.6, KY1 + WALL_HALF + 0.3, 7.6, PI, 'L0', s=1.5)
    # back wall (the great tower stands engaged in its middle: no windows behind its drum)
    back_open = []
    for sx in (-1, 1):
        for wx in (7.09, 11.82):
            back_open.append((sx * wx, KY0, 5.0, 'w04'))
            back_open.append((sx * wx, KY0, 10.0, 'w04'))
    solid_wall(KX - WALL_HALF, KY0, -KX + WALL_HALF, KY0, 0, KEEP_H, openings=back_open)
    # sides: the wing door on the ground storey; plain where the wings' roofs
    # meet them; a window above, behind the wing (its lean-to reaches 12)
    for sx in (-1, 1):
        solid_wall(sx * KX, KC0, sx * KX, KC1, 0, KEEP_H,
                   openings=[(sx * KX, KY0 + 6.25, 0.0, 'arch'), (sx * KX, KY0 + 2.0, 10.0, 'w04')])
    # the roof: the kit's gable roof, the stone gables closing its ends, the finials
    RIDGE = tile_roof(-KX, KX, KY0, KY1, KEEP_H, 'H2')
    for sx in (-1, 1):
        stone_gable(sx * KX, (KY0 + KY1) / 2, KEEP_H - 0.1, RIDGE, (KY1 - KY0) / 2 + 0.3, 'L0', thick=WALL_T)
        gold_finial(sx * (KX + 0.2), (KY0 + KY1) / 2, RIDGE - 0.35, 3.8, 'L0')

    # ================= WINGS (barracks west, kitchen east) =================
    for sx in (-1, 1):
        # front wall on the courtyard with a door, windowed upstairs (two storeys, one box)
        wf_cells, _w = cells_along(sx * (KX + WALL_HALF), KY1, sx * (CX - CURTAIN_HALF), KY1)
        solid_wall(sx * (KX + WALL_HALF), KY1, sx * (CX - CURTAIN_HALF), KY1, 0, 2 * WING_H,   # between the keep's and the curtain's boxes
                   openings=[(sx * WING_DOOR, KY1, 0.0, 'arch')] +
                            [(cx_, cy_, WING_H, 'w05') for k, (cx_, cy_) in enumerate(wf_cells) if k % 2 == 0])
        col(sx * WING_DOOR, KY1, 7.6, 1.6, WALL_HALF + 0.05, 2.6)   # the wall over the door, for the room upstairs
        # upper floor (H1): tiles over the wing, a stair up along the rear wall
        for ix in range(4):
            for iy in range(4):
                cy_ = WY0 + 1.25 + iy * M
                if ix == 3 and cy_ > WY0 + 1.5:
                    continue                                   # the stairwell
                use('buildings/Floor_01', sx * (KX + 1.25 + ix * M), cy_, WING_H, 0, 'H1')
        # The upper floor is a BOX, not a deck: the engine keeps one walkable
        # deck per (x, z), so a deck up here would take the wing's ground
        # floor with it. Its top sits 0.02 under the stair's summit, the rule
        # every upper storey follows (a grounded mover steps DOWN onto a box).
        col(sx * (KX + 3.96), (WY0 + KY1) / 2, WING_H + 0.08 - 0.06, 3.54, 4.58, 0.06)      # the floor, up to the stairwell
        # The stair climbs the outer wall from the BACK of the room to the
        # front (the rear corner tower's drum stands in the back corner), a
        # strip x 20.6..23, foot y -10 to head y -3.2, with a landing at the
        # head and a balustrade on the room side. The upper floor box stops at
        # the strip so nobody floats over the stairwell.
        SX0, SX1 = sx * (KX + 7.6), sx * (KX + 10.0)
        stone_stair(min(SX0, SX1), max(SX0, SX1), WY0 + 2.0, KY1 - 1.2, 0.2, WING_H + 0.1, 12, 'L0')
        # (no rail box: the 64-box budget went to the gatehouse jambs; the fences upstairs are art)
        col(sx * (KX + 8.8), KY1 - 0.8, WING_H + 0.08 - 0.06, 1.2, 0.4, 0.06)               # the landing at the head
        for kf in range(5):
            use('buildings/CastleFence_01', sx * (KX + 7.5), WY0 + 2.6 + kf * 1.24, WING_H + 0.1, PI / 2, 'H1')
        ceiling(sx * (KX + 0.6), sx * (CX - CURTAIN_HALF), WY0 + 0.9, KY1 - 0.6, WING_H, skip=(sx * (KX + 7.6), sx * (KX + 10.0), WY0 + 2.0, KY1 - 1.2))
        # the lean-to sits ON the wing's two storeys (top 10): 12 at the keep
        # wall down to 10.6 at the curtain, its ends closed with stone wedges
        lean_roof(sx * KX, sx * CX, WY0, KY1, 2 * WING_H + 2.0, 2 * WING_H + 0.6, 'H2')
        for y_end in (WY0, KY1):
            lean_gable(sx * KX, sx * CX, y_end, 2 * WING_H - 0.1, 2 * WING_H + 2.0, 2 * WING_H + 0.6, 'L0', thick=WALL_T)

    # ================= COURTYARD (L0) =================
    for ix in range(19):
        for iy in range(10):
            use('environment/Tile_01', -CX + 1.5 + M / 2 + ix * M, KY1 + M / 2 + iy * M, 0.0, 0, 'L0')
    use('environment/Fountain_01', 0, 11.0, 0.166, 0, 'L0', s=1.35)
    col(0, 11.0, 1.2, 2.2, 2.2, 1.0)
    for tx, ty in ((-9.0, 7.0), (9.0, 7.0), (-9.0, 16.0), (9.0, 16.0)):
        use('nature/Tree_02', tx, ty, 0.166, 0.6 * tx, 'L0', s=0.9)
    for bx, by in ((-16.0, 4.0), (16.0, 4.0), (-16.0, 19.0), (16.0, 19.0)):
        brazier(bx, by, 0.166, collide=(by > 10))     # the rear pair's boxes went to the wall walk
    # banner masts along the side curtains
    for sx in (-1, 1):
        for my_ in (2.5, 12.0, 21.0):
            use('buildings/CastlePart_01', sx * (CX - CURTAIN_HALF - 2.4), my_, 0.166, 0, 'L0', s=0.6)
            use('props/Flag_02', sx * (CX - CURTAIN_HALF - 2.4), my_, 4.6, sx * PI / 2, 'L0', s=1.3)
    # steps into the keep: the hall floor is level with the yard, a threshold

    # ================= GREAT HALL (L0) =================
    for ix in range(10):
        for iy in range(5):
            use('buildings/Floor_01', -KX + 1.5 + M / 2 + ix * M, KY0 + 1.0 + M / 2 + iy * M, 0.0, 0, 'L0')
    # runner from the doors to the dais
    for cy_ in (KY1 - 1.5, KY1 - 4.0, KY1 - 6.5, KY1 - 9.0):
        use('props/Carpet_02', 0, cy_, 0.115, PI / 2, 'L0', sy=1.6, sx=1.7)
    DAIS_BACK, DAIS_FRONT, DAIS_H = KY0 + 0.6, KY0 + 4.2, 1.0
    stone_slab(0, (DAIS_BACK + DAIS_FRONT) / 2, 0.0, 4.4, (DAIS_FRONT - DAIS_BACK) / 2, DAIS_H * 0.55 / 2)
    stone_slab(0, (DAIS_BACK + DAIS_FRONT) / 2 - 0.16, DAIS_H * 0.55, 4.15, (DAIS_FRONT - DAIS_BACK) / 2 - 0.16, DAIS_H * 0.45 / 2)
    flat_steps(0, DAIS_FRONT, 5.0, 3, DAIS_H)
    col(0, (DAIS_BACK + DAIS_FRONT) / 2, (DAIS_H - 0.02) / 2, 4.4, (DAIS_FRONT - DAIS_BACK) / 2, (DAIS_H - 0.02) / 2)
    use('props/Throne_01', 0, DAIS_BACK + 1.1, DAIS_H, PI, 'L0', s=1.65 / 1.942)
    use('props/Carpet_02', 0, DAIS_FRONT + 1.0, DAIS_H + 0.01, PI / 2, 'L0', sx=1.1, sy=2.4)
    for sx in (-1, 1):
        use('props/Candle_05', sx * 3.0, DAIS_BACK + 1.1, DAIS_H, sx * 0.15, 'L0', s=0.85)
        use('props/Flag_04', sx * 2.2, KY0 + 0.25, 3.5, 0, 'L0', s=1.2)
        use('props/Flag_02', sx * 6.5, KY0 + 0.25, 3.5, 0, 'L0', s=1.2)
    use('props/Shield_02', 0, KY0 + 0.25, 3.9, 0, 'L0', s=1.4)
    # pillars in two rows, braziers between them, chandeliers overhead
    for sx in (-1, 1):
        for py in (KY1 - 3.0, KY1 - 6.5, KY1 - 10.0):
            use('buildings/CastlePart_02', sx * 6.0, py, 0.2, 0, 'L0', s=0.92)     # 4.42 tall: their caps meet the ceiling joists, not the floor (Troy: "clipping through the floor")
            col(sx * 6.0, py, 2.4, 0.46, 0.46, 2.2)
        for by in (KY1 - 4.75, KY1 - 8.25):
            brazier(sx * 3.4, by, 0.1, collide=False)
        for ly in (KY1 - 3.5, KY1 - 8.5):
            use('props/Light_01', sx * 3.0, ly, 4.25, 0, 'L0', s=1.1)     # under the middle floor
        # side bays: a feast table west, the arms east
        if sx < 0:
            # under the stair: stores
            use('props/Barrel_01', -11.3, KY0 + 1.6, 0.2, 0.4, 'L0')
            use('props/Box_01', -11.6, KY0 + 2.8, 0.2, 0.9, 'L0')
            use('props/Altar_02', -KX + 0.9, KY0 + 1.4, 0.2, PI / 2, 'L0')
            use('props/Helmet_01', -KX + 0.9, KY0 + 1.4, 0.2 + 1.349, 0.3, 'L0')
        else:
            use('props/Table_02', 9.2, KY1 - 6.5, 0.2, PI / 2, 'L0', sx=1.3, sy=1.1)
            for k in range(3):
                use('props/Furniture_08', 8.0, KY1 - 5.2 - 1.3 * k, 0.2, -PI / 2, 'L0', s=0.9)
                use('props/Furniture_08', 10.4, KY1 - 5.2 - 1.3 * k, 0.2, PI / 2, 'L0', s=0.9)
            use('props/PlateFood_01', 9.2, KY1 - 5.8, 0.87, 0.3, 'L0')
            use('props/Cup_02', 8.8, KY1 - 6.9, 0.87, 0, 'L0')
            use('props/Candle_03', 9.5, KY1 - 7.4, 0.87, 0, 'L0')
            # arms on the east wall past the wing door (its bay is y -11.15..-8.35)
            use('props/Weapon_03', KX - 0.5, KY0 + 3.6, 2.4, -PI / 2, 'L0')
            use('props/Weapon_05', KX - 0.5, KY0 + 1.2, 2.4, -PI / 2, 'L0')
            use('props/Shield_03', KX - 0.5, KY0 + 2.4, 2.4, -PI / 2, 'L0')
            use('props/Chest_01', KX - 0.9, KY1 - 3.6, 0.2, -PI / 2, 'L0')

    # ================= THE WARDEN'S FLOOR (third storey) =================
    # An L-shaped stair (Troy: "add an L shaped staircase so the user can go
    # up"): flight A up the hall's west bay to a landing in the back-west
    # corner AT the middle floor, flight B east along the back wall up to the
    # Warden's floor. Boxes for the floors (one walkable deck per (x,z)), each
    # topping 0.02 under its flight's summit.
    ST_X0, ST_X1 = -12.4, -10.0
    ST_Y0, ST_Y1 = KY1 - 0.9, KY0 + 3.6          # A: -2.9 .. -12.4
    MF, UF = 5.0, 10.0
    stone_stair(ST_X0, ST_X1, ST_Y0, ST_Y1, 0.2, MF + 0.1, 14, 'L0')                     # A: 0.2 -> 5.1
    BX0, BX1, BY0, BY1 = ST_X1, -3.0, KY0 + 0.6, ST_Y1                                   # B: x -10 -> -3 along y -15.4..-12.4
    stone_stair_x(BX0, BX1, BY0, BY1, MF + 0.1, UF + 0.1, 12, 'L0')                      # B: 5.1 -> 10.1
    riseA = (MF + 0.1 - 0.2) / 14
    dA = (ST_Y1 - ST_Y0) / 14
    for i in range(0, 14, 2):    # a raking parapet on A's open side (art; no rail box)
        stone_slab(ST_X1 + 0.1, ST_Y0 + (i + 1) * dA, 0.2 + (i + 1.5) * riseA, 0.14, abs(dA) + 0.02, 0.5, 'L0')
    riseB = (UF - MF) / 12
    dB = (BX1 - BX0) / 12
    for i in range(0, 12, 2):    # and on B's open side
        stone_slab(BX0 + (i + 1) * dB, BY1 - 0.1, MF + 0.1 + (i + 1.5) * riseB, abs(dB) + 0.02, 0.14, 0.5, 'L0')
    # the Warden's floor: tiles from the west wall, the stairwell over B only; two boxes round it
    for ix in range(10):
        for iy in range(5):
            cx_, cy_ = -KX + 0.6 + M / 2 + ix * M, KY0 + 1.0 + M / 2 + iy * M
            if cy_ < BY1 and cx_ - M / 2 < BX1 + 0.1:
                continue                        # over flight B and the landing
            use('buildings/Floor_01', cx_, cy_, UF, 0, 'H3')
    col(0.0, (BY1 + KY1 - 0.65) / 2, UF + 0.05 - 0.06, KX - 0.6, (KY1 - 0.65 - BY1) / 2, 0.06)          # front part
    col((BX1 + KX - 0.6) / 2, (KY0 + 0.65 + BY1) / 2, UF + 0.05 - 0.06, (KX - 0.6 - BX1) / 2, (BY1 - KY0 - 0.65) / 2, 0.06)   # back part, east of the stairwell
    # a plank ceiling under it, always visible (Troy: "floors seem to be missing for each level")
    ceiling(-KX + 0.6, KX - 0.6, KY0 + 0.6, KY1 - 0.6, UF, skip=(BX0 - 2.5, BX1, BY0, BY1))
    # a balustrade round the stairwell (art)
    for k in range(8):
        use('buildings/CastleFence_01', ST_X0 + 0.62 + k * 1.24, BY1 + 0.15, UF + 0.1, 0, 'H3')
    for k in range(2):
        use('buildings/CastleFence_01', BX1 + 0.15, BY1 - 0.62 - k * 1.24, UF + 0.1, PI / 2, 'H3')
    # the Warden's rooms (H3): the council end, her bed chamber, the wall of
    # arms, nothing in flight B's stairwell (x -10..-3, y -15.4..-12.4)
    XW, XE, YB, YF = -KX + 0.65, KX - 0.65, KY0 + 0.65, KY1 - 0.65      # the inner faces
    use('props/Table_02', 3.0, KY1 - 6.0, UF + 0.2, 0, 'H3', sx=1.6, sy=1.2)
    for k in range(4):
        use('props/Furniture_08', 0.2 + k * 1.5, KY1 - 4.6, UF + 0.2, PI, 'H3', s=0.9)
        use('props/Furniture_08', 0.2 + k * 1.5, KY1 - 7.4, UF + 0.2, 0, 'H3', s=0.9)
    use('props/Carpet_02', 3.0, KY1 - 6.0, UF + 0.11, 0, 'H3', sx=2.2, sy=1.7)
    use('props/Scroll_01', 2.2, KY1 - 5.7, UF + 0.87, 0.4, 'H3')
    use('props/Scroll_02', 3.6, KY1 - 6.2, UF + 0.87, -0.6, 'H3')
    use('props/Book_05', 3.8, KY1 - 6.4, UF + 0.87, 0.2, 'H3')
    use('props/Pointer_01', 2.8, KY1 - 6.1, UF + 0.87, 0.9, 'H3')
    use('props/Candle_03', 0.4, KY1 - 6.0, UF + 0.87, 0, 'H3', s=0.8)
    use('props/Candle_03', 5.6, KY1 - 6.0, UF + 0.87, 0, 'H3', s=0.8)
    # the bed chamber, east end
    use('props/Bed_02', 9.4, KY0 + 2.4, UF + 0.2, 0, 'H3', s=1.05)
    use('props/Furniture_01', XE - 0.3, KY0 + 4.9, UF + 0.2, -PI / 2, 'H3')                 # tall cabinet on the east wall
    use('props/Furniture_05', XE - 0.3, KY0 + 7.2, UF + 0.2, -PI / 2, 'H3')                 # dressing table
    use('props/Candle_05', XE - 0.3, KY0 + 7.2, UF + 1.2, 0, 'H3', s=0.7)
    use('props/Chest_01', 11.6, KY0 + 1.0, UF + 0.2, 0, 'H3')
    use('props/Carpet_04', 8.0, KY0 + 5.5, UF + 0.11, PI / 2, 'H3', s=1.5)
    use('props/Furniture_14', 6.5, YB + 0.32, UF + 0.2, 0, 'H3')                              # low chest of drawers on the back wall
    use('props/Book_05', 5.8, YB + 0.32, UF + 1.17, 0.3, 'H3')
    use('props/Bottle_02', 7.2, YB + 0.32, UF + 1.17, 0, 'H3')
    use('buildings/Fireplace_01', XE - 0.03, KY1 - 10.0, UF, PI / 2, 'H3', s=1.1)            # hearth on the east wall
    for bx in (0.0, 2.6):
        use('props/Furniture_03', bx, YB + 0.3, UF + 0.2, 0, 'H3')                            # bookcases, clear of B's stairwell
    use('props/Altar_02', XW + 0.9, KY1 - 4.0, UF + 0.2, PI / 2, 'H3')
    use('props/Helmet_02', XW + 0.9, KY1 - 4.0, UF + 0.2 + 1.349, 0.3, 'H3')
    for k in range(2):
        use('props/Barrel_0%d' % (1 + k), XW + 0.6 + k * 0.9, KY1 - 1.4, UF + 0.2, 0.5 * k, 'H3')
    # wall decor: banners between the front windows, arms on the west wall, shields over the hearth
    for sx in (-1, 1):
        use('props/Flag_04', sx * 5.65, YF - 0.05, UF + 4.2, PI, 'H3', s=1.4)
        use('props/Flag_02', sx * 9.6, YF - 0.05, UF + 4.2, PI, 'H3', s=1.2)
        use('props/Flag_02', sx * 5.5, YB + 0.05, UF + 4.4, 0, 'H3', s=1.3)
    for k, wy in enumerate((KY1 - 6.0, KY1 - 8.0)):
        use('props/Shield_0%d' % (1 + k), XW + 0.08, wy, UF + 2.8, -PI / 2, 'H3', s=1.3)
        use('props/Weapon_03', XW + 0.1, wy - 0.7, UF + 2.3, -PI / 2, 'H3')
        use('props/Weapon_05', XW + 0.1, wy + 0.7, UF + 2.3, -PI / 2, 'H3')
    use('props/Shield_03', XE - 0.08, KY1 - 10.0, UF + 3.6, PI / 2, 'H3', s=1.4)
    use('props/Weapon_01', XE - 0.1, KY1 - 9.2, UF + 3.0, PI / 2, 'H3')
    use('props/Weapon_04', XE - 0.1, KY1 - 10.8, UF + 3.0, PI / 2, 'H3')
    for sx in (-1, 1):
        use('props/Light_01', sx * 4.0, KY1 - 7.5, UF + 4.2, 0, 'H3', s=1.1)
    use('props/Light_01', 3.0, KY0 + 4.5, UF + 4.2, 0, 'H3', s=1.1)

    # ================= THE MIDDLE FLOOR (second storey) =================
    # Troy: "add another floor in the middle so the castle has 3 floors", "those
    # pillars should be holding up another floor". Tiles over the hall at z 5
    # (their grid starts at x -10 so nothing hangs over the flight), one box
    # under them topping 0.02 under the flight where it passes; a balustrade
    # round the stairwell with a gap where the flight meets the floor.
    for ix in range(10):
        for iy in range(5):
            cx_, cy_ = -KX + 0.6 + M / 2 + ix * M, KY0 + 1.0 + M / 2 + iy * M
            if cx_ < ST_X1 and cy_ > ST_Y1:
                continue                        # over flight A
            use('buildings/Floor_01', cx_, cy_, MF, 0, 'H1')
    col((ST_X1 + KX - 0.6) / 2, (ST_Y1 + KY1 - 0.65) / 2, MF + 0.05 - 0.06, (KX - 0.6 - ST_X1) / 2, (KY1 - 0.65 - ST_Y1) / 2, 0.06)   # front part, east of A
    col(0.0, (KY0 + 0.65 + ST_Y1) / 2, MF + 0.05 - 0.06, KX - 0.6, (ST_Y1 - KY0 - 0.65) / 2, 0.06)                              # back part: the landing + under B
    for k in range(8):
        yk = ST_Y0 - 0.3 - 0.62 - k * 1.24
        if yk < ST_Y1 + 0.3:
            break
        use('buildings/CastleFence_01', ST_X1 + 0.1, yk, MF + 0.1, PI / 2, 'H1')
    ceiling(-KX + 0.6, KX - 0.6, KY0 + 0.6, KY1 - 0.6, MF, skip=(ST_X0, ST_X1, ST_Y1, ST_Y0))
    # the library and the gallery (H1): bookcases along the back wall east of
    # flight B, the long table, a scribe's desk by the window, the hearth on
    # the east wall, stores in the corner; nothing in A's or B's stairwells
    for bx in (-1.5, 1.0, 3.5, 6.0, 8.5, 11.0):
        use('props/Furniture_03', bx, YB + 0.3, MF + 0.2, 0, 'H1')
    use('props/Furniture_02', XW + 0.3, KY1 - 6.0, MF + 0.2, PI / 2, 'H1')                   # (west wall, past A's fence)
    use('props/Table_02', 3.0, KY1 - 6.0, MF + 0.2, 0, 'H1', sx=1.5, sy=1.2)
    for k in range(3):
        use('props/Furniture_08', 1.0 + k * 1.5, KY1 - 4.7, MF + 0.2, PI, 'H1', s=0.9)
        use('props/Furniture_08', 1.0 + k * 1.5, KY1 - 7.3, MF + 0.2, 0, 'H1', s=0.9)
    use('props/Carpet_02', 3.0, KY1 - 6.0, MF + 0.11, 0, 'H1', sx=2.0, sy=1.6)
    use('props/Book_05', 2.4, KY1 - 6.3, MF + 0.87, 0.3, 'H1')
    use('props/Book_02', 3.6, KY1 - 5.7, MF + 0.87, -0.5, 'H1')
    use('props/Scroll_01', 4.2, KY1 - 6.4, MF + 0.87, -0.4, 'H1')
    use('props/Candle_03', 1.2, KY1 - 6.0, MF + 0.87, 0, 'H1', s=0.8)
    use('props/Candle_03', 4.8, KY1 - 6.0, MF + 0.87, 0, 'H1', s=0.8)
    use('props/Furniture_05', -7.5, YF - 0.6, MF + 0.2, PI, 'H1')                            # scribe's desk under the front windows
    use('props/Furniture_08', -7.5, YF - 1.5, MF + 0.2, 0, 'H1', s=0.9)
    use('props/Ink_01', -7.9, YF - 0.6, MF + 1.2, 0, 'H1')
    use('props/Scroll_03', -7.1, YF - 0.6, MF + 1.2, 0.5, 'H1')
    use('props/Candle_05', -6.6, YF - 0.6, MF + 1.2, 0, 'H1', s=0.7)
    use('props/Table_01', -5.0, KY1 - 10.0, MF + 0.2, PI / 2, 'H1')
    use('props/Furniture_08', -6.1, KY1 - 10.0, MF + 0.2, -PI / 2, 'H1', s=0.9)
    use('props/Furniture_08', -3.9, KY1 - 10.0, MF + 0.2, PI / 2, 'H1', s=0.9)
    use('props/Book_09', -5.0, KY1 - 10.0, MF + 0.87, 0.2, 'H1')
    use('buildings/Fireplace_01', XE - 0.03, KY1 - 8.5, MF, PI / 2, 'H1', s=1.1)             # hearth on the east wall
    use('props/Carpet_04', 9.5, KY1 - 8.5, MF + 0.11, 0, 'H1', s=1.4)
    use('props/Furniture_10', 9.0, KY1 - 6.5, MF + 0.2, PI / 2, 'H1')                        # a bench by the fire
    for k in range(3):
        use('props/Barrel_0%d' % (1 + k % 3), XE - 0.6, YF - 0.6 - k * 0.95, MF + 0.2, 0.4 * k, 'H1')
    use('props/Box_01', XE - 1.6, YF - 0.7, MF + 0.2, 0.3, 'H1')
    use('props/Chest_01', XE - 0.6, KY0 + 3.0, MF + 0.2, -PI / 2, 'H1')
    # wall decor: banners between the front windows and on the back wall,
    # shields and arms on the west wall (the stretch north of A's stairwell)
    for sx in (-1, 1):
        use('props/Flag_02', sx * 5.65, YF - 0.05, MF + 4.2, PI, 'H1', s=1.3)
        use('props/Flag_04', sx * 9.6, YF - 0.05, MF + 4.2, PI, 'H1', s=1.3)
    for bx in (-0.25, 4.75, 9.75):
        use('props/Flag_04', bx, YB + 0.05, MF + 4.5, 0, 'H1', s=1.2)
    use('props/Shield_02', XE - 0.08, KY1 - 8.5, MF + 3.7, PI / 2, 'H1', s=1.4)             # over the hearth
    use('props/Weapon_02', XE - 0.1, KY1 - 7.7, MF + 3.1, PI / 2, 'H1')
    use('props/Weapon_04', XE - 0.1, KY1 - 9.3, MF + 3.1, PI / 2, 'H1')
    use('props/Shield_01', XW + 0.08, KY1 - 3.6, MF + 2.9, -PI / 2, 'H1', s=1.3)
    for sx in (-1, 1):
        use('props/Light_01', sx * 4.0, KY1 - 7.5, MF + 4.3, 0, 'H1', s=1.0)
    use('props/Light_01', 3.0, KY0 + 4.5, MF + 4.3, 0, 'H1', s=1.0)

    # ================= WING INTERIORS =================
    # west: the barracks. east: the kitchen and stores.
    for ix in range(4):
        for iy in range(4):
            for sx in (-1, 1):
                use('buildings/Floor_01', sx * (KX + 1.25 + ix * M), WY0 + 1.25 + iy * M, 0.0, 0, 'L0')
    for k in range(4):
        use('props/Bed_0%d' % (1 + k % 4), -(KX + 1.6), WY0 + 1.3 + k * 2.2, 0.2, PI / 2, 'L0', s=0.95)
    use('props/Chest_01', -(KX + 4.0), WY0 + 0.9, 0.2, 0, 'L0')
    use('props/Weapon_01', -(KX + 0.5), WY0 + 8.6, 2.2, PI / 2, 'L0')
    use('props/Shield_01', -(KX + 0.5), WY0 + 7.4, 2.2, PI / 2, 'L0')
    use('props/Furniture_03', -(KX + 6.5), WY0 + 1.0, 0.2, 0, 'L0')
    use('buildings/Fireplace_01', KX + 6.0, WY0 + 0.75, 0.2, 0, 'L0', s=1.1)
    use('props/Table_01', KX + 4.0, WY0 + 5.0, 0.2, 0, 'L0', sx=1.2)
    for k in range(3):
        use('props/Barrel_0%d' % (1 + k % 3), KX + 9.8, WY0 + 1.2 + k * 1.1, 0.2, 0.4 * k, 'L0')
    use('props/Bag_02', KX + 8.6, WY0 + 1.1, 0.2, 0.3, 'L0')
    use('props/Box_01', KX + 8.7, WY0 + 2.6, 0.2, 0.9, 'L0')
    use('props/Food_03', KX + 4.2, WY0 + 5.1, 0.87, 0, 'L0')
    use('props/Pot_01', KX + 6.0, WY0 + 1.3, 0.55, 0, 'L0')
    # upstairs (H1): a solar west, the guard room east
    use('props/Bed_02', -(KX + 8.0), WY0 + 2.0, WING_H + 0.2, PI / 2, 'H1', s=1.0)
    use('props/Furniture_14', -(KX + 4.0), WY0 + 5.5, WING_H + 0.2, 0, 'H1')
    use('props/Carpet_04', -(KX + 5.0), WY0 + 4.0, WING_H + 0.11, 0, 'H1', s=1.4)
    use('props/Candle_05', -(KX + 4.0), WY0 + 5.5, WING_H + 0.9, 0, 'H1', s=0.8)
    use('props/Table_01', KX + 5.0, WY0 + 4.5, WING_H + 0.2, PI / 2, 'H1')
    use('props/Furniture_08', KX + 3.8, WY0 + 4.5, WING_H + 0.2, -PI / 2, 'H1', s=0.9)
    use('props/Furniture_08', KX + 6.2, WY0 + 4.5, WING_H + 0.2, PI / 2, 'H1', s=0.9)
    use('props/Weapon_02', KX + 0.5, WY0 + 7.5, WING_H + 2.2, -PI / 2, 'H1')
    use('props/Weapon_04', KX + 0.5, WY0 + 6.0, WING_H + 2.2, -PI / 2, 'H1')

    # ================= BRASS + RUNES =================
    for sx in (-1, 1):
        for face in (CURTAIN_HALF, -CURTAIN_HALF):
            rune_run(sx * (CX - CORNER_R), CYF, sx * (2.5 + 2 * GATE_R), CYF, 3.1, -sx * face)   # front, from the corner tower
            rune_run(sx * CX, CYF - CORNER_R, sx * CX, WY0 + CORNER_R, 3.1, sx * face)          # sides, from the front corner
        brass_run(sx * (CX - CORNER_R), CYF, sx * (2.5 + 2 * GATE_R), CYF, 2.6, out=-sx * (CURTAIN_HALF + 0.08))
        brass_run(sx * CX, CYF - CORNER_R, sx * CX, WY0 + CORNER_R, 2.6, out=sx * (CURTAIN_HALF + 0.08))
    # keep front: conduit on the plain cells only (the windows fill the rest),
    # the string courses at the storey lines where nothing crosses them
    dress_cells(KF, 3.1, (WALL_HALF,))
    brass_run(-KX + 0.5, KY1, KX - 0.5, KY1, 5.0, out=WALL_HALF + 0.08)
    brass_run(-KX + 0.5, KY1, KX - 0.5, KY1, 10.0, out=WALL_HALF + 0.08)

    # ================= COLLISION =================
    T = WALL_HALF + 0.05
    TC = CURTAIN_HALF + 0.05
    for sx in (-1, 1):
        col_wall(sx * (2.5 + 2 * GATE_R), CYF, sx * (CX - CORNER_R), CYF, 0, CURTAIN_H + 1.8, TC)
        col_wall(sx * CX, WY0 + CORNER_R, sx * CX, CYF - CORNER_R, 0, 2 * WING_H + 1.8, TC)
        col_wall(sx * KX, WY0, sx * (CX - CORNER_R), WY0, 0, 2 * WING_H + 1.8, T)
        # keep front halves either side of the door, keep sides, wing fronts
        col_wall(sx * 1.4, KY1, sx * KX, KY1, 0, KEEP_H + 1.2, T)
        col_wall(sx * KX, KY0, sx * KX, KY0 + 4.75, 0, KEEP_H + 1.2, T)
        col_wall(sx * KX, KY0 + 7.75, sx * KX, KY1, 0, KEEP_H + 1.2, T)
        col_wall(sx * KX, KY1, sx * (WING_DOOR - 1.4), KY1, 0, 2 * WING_H + 1.2, T)
        col_wall(sx * (WING_DOOR + 1.4), KY1, sx * CX, KY1, 0, 2 * WING_H + 1.2, T)
    # (no door lintel boxes: an arch apex is 3.8-5.7 yd up, past any jump)
    for sx in (-1, 1):
        col(sx * (GATE_HW + 0.55), CYF, GATE_H / 2, 0.55, TC, GATE_H / 2)                    # gate jambs
    col_wall(-KX, KY0, KX, KY0, 0, KEEP_H + 1.2, T)
    interior(-KX + 0.3, KX - 0.3, KY0 + 0.3, KY1 - 0.3, 0.0, KEEP_H)
    interior(KX + 0.3, CX - 0.3, WY0 + 0.3, KY1 - 0.3, 0.0, WING_H)
    interior(-CX + 0.3, -KX - 0.3, WY0 + 0.3, KY1 - 0.3, 0.0, WING_H)
    # Every banner in the castle flies the Warden's royal blue: the kit's flags
    # are red/green atlas cells, and the roof recolour turns any warm cell blue.
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.data and str(o.get('woc_piece', '')).startswith('props/Flag'):
            o.data = o.data.copy()
            for i, slot in enumerate(o.material_slots):
                if slot.material and 'CartoonTown' in slot.material.name:
                    o.data.materials[i] = royal_roof_material()
    print('COLS', len(COLS), 'RAMPS', len(RAMPS))

    exec(open(SCRATCH + '/bl_lite.py').read())
    flatten_tiles()
    dissolve_planar()
    decimate_slabs()
    finalize('tidehold_castle_b', SCRATCH + '/out', S)
    print('CASTLE B DONE')
except Exception:
    print(traceback.format_exc())
