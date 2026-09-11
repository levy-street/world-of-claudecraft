# Deepglass warden gate, an arched gateway in the Warden Wall's language
# (mottled grey stone, dark chamfered socle, riveted brass straps, cyan rune
# conduits + sigils), in two states:
#   closed - two dark-iron leaves, brass-strapped, shut across the arch
#   open   - the same leaves swung back flat against the passage walls
#
# Kit-compatible with deepglass/warden_wall: 8 wide (X, two wall modules),
# 6.4 tall to the merlon tops (1.6x the 4-tall wall), the panel 1.34 deep (Y)
# with 1.9-deep piers, origin on the ground at the centre. The doors swing to
# -Y (glTF +Z, the wall tower's "city side"). asset_scale.ts keeps the gate at
# the WALL's yards-per-scale (0.55 yd per model yard), so a gate placed at the
# same scale as a wall run stands 1.6x its height with matching courses.
#
# Collision sidecar (<tag>.collision.json, glTF frame, model yards, converted
# by install_gate.mjs at the wall's norm): piers, the arch above head height
# (passesUnder), and the leaves - across the opening when closed, along the
# passage walls when open.
#
# Headless: GATE_VARIANT=open|closed [PREVIEW=1] Blender -b --python <this>
import os
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/carve/scripts/assets/deepglass/dg_lib.py").read())
    OUT_DIR = "/Users/troy/Documents/woc/carve/tmp/asset_src/deepglass"
    os.makedirs(OUT_DIR, exist_ok=True)
    VARIANT = str(globals().get("VARIANT", os.environ.get("GATE_VARIANT", "closed")))
    PREVIEW = bool(globals().get("PREVIEW", os.environ.get("PREVIEW", "") == "1"))
    reset_scene()
    studio_lights()

    W, D, RAIL = 8.0, 0.80, 1.04          # the wall's slab / rail depths
    PIER_X, PW, PD = 3.0, 2.0, 1.90        # pier centres, section
    OPEN_HW = 2.0                          # half width of the opening (x -2..2)
    SPRING = 2.6                           # arch springing height
    R_IN = OPEN_HW                         # intrados radius (apex 4.6)
    R_OUT = 2.55                           # voussoir ring outer radius
    Z_WALL = 5.45                          # spandrel wall top (crown starts)
    LEAF_T = 0.22                          # door leaf thickness

    M_STONE, M_DARK, M_BRASS, M_RUNE = 0, 1, 2, 3
    mats = [
        mat_stone("dgg_stone", STONE, STONE_DARK, scale=3.2, bump=0.30),
        mat_stone("dgg_stone_dark", STONE_DARK, srgb(0x4a463f), scale=4.5, bump=0.38),
        mat_brass("dgg_brass", scale=5.0, patina=0.28),
        mat_rune("dgg_rune", RUNE_CYAN, 1.2),
    ]

    COLL = []    # (x, y, z0, z1, hx, hy) Blender frame

    def build(bm):
        def slab(size, z0, z1, mat, x=0.0, y=0.0):
            box(bm, (size[0], size[1], z1 - z0), center=(x, y, (z0 + z1) * 0.5), mat=mat)

        def rivet(x, y, z, along_x=True):
            box(bm, (0.13, 0.06, 0.13) if along_x else (0.06, 0.13, 0.13), center=(x, y, z), mat=M_BRASS)

        def strap(z0, z1, half_depth, x0, x1, rivets=4, y=0.0):
            slab((x1 - x0, half_depth * 2, 0), z0, z1, M_BRASS, x=(x0 + x1) * 0.5, y=y)
            zc = (z0 + z1) * 0.5
            for k in range(rivets):
                x = x0 + (x1 - x0) * (k + 0.5) / rivets
                for s in (-1, 1):
                    rivet(x, y + s * (half_depth + 0.025), zc)

        def lozenge(x, y, z, size=0.30, axis='Y'):
            rot = Matrix.Rotation(math.radians(45), 3, axis)
            box(bm, (size, 0.07, size), center=(x, y, z), mat=M_RUNE, rot=rot)

        def rune_vertical(x, y, zs, r=0.045):
            pts = [Vector((x, y, z)) for z in zs]
            tube_along(bm, pts, r, segs=6, mat=M_RUNE, radii=[r * 0.8, r * 1.3, r * 0.8])

        # ---- piers (the wall's pillar variant, taller) -------------------------
        for sx in (-1, 1):
            px = sx * PIER_X
            slab((PW + 0.34, PD + 0.34), 0.00, 0.36, M_DARK, x=px)
            slab((PW + 0.16, PD + 0.16), 0.36, 0.60, M_DARK, x=px)
            slab((PW, PD), 0.50, Z_WALL, M_STONE, x=px)
            for (z0, z1) in ((0.62, 0.74), (2.50, 2.62), (4.40, 4.52)):
                slab((PW + 0.10, PD + 0.10), z0, z1, M_BRASS, x=px)
                zc = (z0 + z1) * 0.5
                for s in (-1, 1):
                    for dx in (-0.6, 0.0, 0.6):
                        rivet(px + dx, s * (PD / 2 + 0.075), zc)
                    for dy in (-0.55, 0.0, 0.55):
                        rivet(sx * (PIER_X + PW / 2 + 0.075), dy, zc, along_x=False)
            for s in (-1, 1):
                rune_vertical(px, s * (PD / 2 + 0.01), (1.0, 1.75, 2.35))
                rune_vertical(px, s * (PD / 2 + 0.01), (2.85, 3.6, 4.25))
                lozenge(px, s * (PD / 2 + 0.03), 1.75, 0.28)
                lozenge(px, s * (PD / 2 + 0.03), 3.6, 0.28)
            COLL.append((px, 0.0, 0.0, Z_WALL + 1.0, PW / 2 + 0.17, PD / 2 + 0.17))

        # ---- spandrel wall over the arch: stepped columns follow the intrados --
        N_COL = 16
        cw = (2 * OPEN_HW) / N_COL
        for k in range(N_COL):
            xc = -OPEN_HW + cw * (k + 0.5)
            zb = SPRING + math.sqrt(max(0.0, R_IN * R_IN - xc * xc))
            slab((cw + 0.002, D), zb, Z_WALL, M_STONE, x=xc)
        # panel rails (the wall's frame) above the arch
        slab((2 * OPEN_HW + 0.02, RAIL), Z_WALL - 0.24, Z_WALL, M_STONE)
        # voussoir ring: rotated stone blocks proud of the wall face
        N_V = 13
        for k in range(N_V):
            a0 = math.pi * k / N_V
            a1 = math.pi * (k + 1) / N_V
            am = (a0 + a1) * 0.5
            rm = (R_IN + R_OUT) * 0.5
            cx, cz = rm * math.cos(am), SPRING + rm * math.sin(am)
            tang = rm * (a1 - a0) * 1.02
            # Blender's Y rotation turns +X toward -Z, so pi/2 - am puts the
            # block's z on the RADIAL and its x along the tangent.
            rot = Matrix.Rotation(math.pi / 2 - am, 3, 'Y')
            key = k == N_V // 2
            box(bm, (tang, RAIL + (0.16 if key else 0.0), R_OUT - R_IN), center=(cx, 0.0, cz),
                mat=M_BRASS if key else M_STONE, rot=rot)
        # keystone sigil on both faces
        for s in (-1, 1):
            lozenge(0.0, s * (RAIL / 2 + 0.10), SPRING + R_OUT - 0.28, 0.34)
        # rune conduit arcing over the ring
        for s in (-1, 1):
            pts = []
            for k in range(11):
                a = math.pi * k / 10
                pts.append(Vector(((R_OUT + 0.16) * math.cos(a), s * (D / 2 + 0.01), SPRING + (R_OUT + 0.16) * math.sin(a))))
            tube_along(bm, pts, 0.045, segs=6, mat=M_RUNE)
        COLL.append((0.0, 0.0, SPRING + R_IN, Z_WALL + 1.0, OPEN_HW, D / 2 + 0.2))

        # ---- crown across the whole gate: strap, dentils, cornice, merlons ------
        strap(Z_WALL, Z_WALL + 0.12, 0.54, -W / 2, W / 2, rivets=8)
        for k in range(21):
            x = -W / 2 + W * (k + 0.5) / 21
            for s in (-1, 1):
                box(bm, (0.17, 0.12, 0.13), center=(x, s * 0.585, Z_WALL + 0.19), mat=M_STONE)
        slab((W, 1.30), Z_WALL + 0.25, Z_WALL + 0.43, M_STONE)     # cornice
        slab((W, 0.70), Z_WALL + 0.43, Z_WALL + 0.51, M_STONE)     # parapet sill
        for x in (-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5):
            slab((0.56, 0.52), Z_WALL + 0.49, Z_WALL + 0.85, M_STONE, x=x)
            slab((0.64, 0.60), Z_WALL + 0.84, Z_WALL + 0.90, M_BRASS, x=x)
            slab((0.50, 0.46), Z_WALL + 0.90, Z_WALL + 0.95, M_BRASS, x=x)
        # pier capitals rising through the crown: brass collar + rune seat lens
        for sx in (-1, 1):
            px = sx * PIER_X
            slab((PW + 0.22, PD + 0.22), Z_WALL + 0.43, Z_WALL + 0.60, M_STONE, x=px)
            slab((PW + 0.30, PD + 0.30), Z_WALL + 0.60, Z_WALL + 0.72, M_BRASS, x=px)
            slab((PW - 0.30, PD - 0.30), Z_WALL + 0.72, Z_WALL + 0.90, M_DARK, x=px)
            torus(bm, 0.40, 0.055, major=24, minor=6, mat=M_BRASS, center=(px, 0, Z_WALL + 0.92))
            lathe(bm, [(0.0, 0.0), (0.34, 0.03), (0.38, 0.09), (0.30, 0.14), (0.0, 0.18)],
                  segs=20, mat=M_RUNE, origin=(px, 0, Z_WALL + 0.90))

        # ---- door leaves: dark iron, brass straps + rivets, a rune sigil --------
        def leaf(sx, open_):
            """One leaf hinged at x = sx*OPEN_HW. Closed: in the y=0 plane
            spanning x from the hinge to the centre. Open: swung 90 deg to lie
            along the passage wall on the -Y side."""
            LW = OPEN_HW - 0.03          # leaf width (a hair short of the centre)
            # local frame: u along the leaf (0 at hinge), v = thickness
            def place(u0, u1, v0, v1, z0, z1, mat):
                if not open_:
                    x0, x1 = sx * OPEN_HW - sx * u1, sx * OPEN_HW - sx * u0
                    slab((abs(x1 - x0), v1 - v0), z0, z1, mat, x=(x0 + x1) * 0.5, y=(v0 + v1) * 0.5)
                else:
                    y0, y1 = -u1, -u0
                    xm = sx * (OPEN_HW - (v0 + v1) * 0.5)
                    slab((v1 - v0, y1 - y0), z0, z1, mat, x=xm, y=(y0 + y1) * 0.5)
            # arched leaf top follows the intrados: stepped columns
            NC = 8
            cw = LW / NC
            for k in range(NC):
                u0, u1 = cw * k, cw * (k + 1)
                # distance from the arch centre for this column's OUTER edge
                xc = OPEN_HW - (u0 + cw * 0.5)
                zt = SPRING + math.sqrt(max(0.0, R_IN * R_IN - xc * xc)) - 0.06
                place(u0, u1 + 0.002, -LEAF_T / 2, LEAF_T / 2, 0.06, zt, M_DARK)
            # straps (three bands) with rivets, both faces
            for (z0, z1) in ((0.55, 0.71), (2.0, 2.16), (3.45, 3.61)):
                place(0.0, LW, -LEAF_T / 2 - 0.03, LEAF_T / 2 + 0.03, z0, z1, M_BRASS)
                for k in range(4):
                    u = LW * (k + 0.5) / 4
                    for v in (-LEAF_T / 2 - 0.06, LEAF_T / 2 + 0.06):
                        place(u - 0.06, u + 0.06, v - 0.03, v + 0.03, (z0 + z1) * 0.5 - 0.06, (z0 + z1) * 0.5 + 0.06, M_BRASS)
            # hinge knuckles on the pier side
            for z in (0.9, 2.3, 3.7):
                place(-0.06, 0.16, -LEAF_T / 2 - 0.08, LEAF_T / 2 + 0.08, z - 0.16, z + 0.16, M_BRASS)
            # rune sigil mid-leaf, both faces
            for v in (-LEAF_T / 2 - 0.045, LEAF_T / 2 + 0.045):
                if not open_:
                    lozenge(sx * (OPEN_HW - LW * 0.5), v, 2.8, 0.30)
                else:
                    rot = Matrix.Rotation(math.radians(45), 3, 'X')
                    box(bm, (0.07, 0.30, 0.30), center=(sx * (OPEN_HW - v), -LW * 0.5, 2.8), mat=M_RUNE, rot=rot)
            if not open_:
                COLL.append((sx * (OPEN_HW - LW * 0.5), 0.0, 0.0, SPRING + R_IN, LW * 0.5, LEAF_T / 2 + 0.06))
            else:
                COLL.append((sx * (OPEN_HW - LEAF_T * 0.5 - 0.02), -LW * 0.5, 0.0, SPRING + R_IN, LEAF_T / 2 + 0.08, LW * 0.5))

        for sx in (-1, 1):
            leaf(sx, VARIANT == "open")

    tag = "warden_gate_" + VARIANT
    bm = bmesh.new()
    build(bm)
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
    size = (max(xs) - min(xs), max(zs) - min(zs), max(ys) - min(ys))   # glTF x, y(up), z
    import json
    json.dump({
        'size': [round(s, 4) for s in size],
        'minY': round(min(zs), 4),
        'boxes': [dict(x=b[0], y=(b[2] + b[3]) * 0.5, z=-b[1], hx=b[4], hy=(b[3] - b[2]) * 0.5, hz=b[5]) for b in COLL],
        'ramps': [],
    }, open(OUT_DIR + f"/{tag}.collision.json", 'w'), indent=1)
    LOG.append(f"variant {VARIANT} size={tuple(round(s, 2) for s in size)} boxes={len(COLL)}")
    ob = new_obj(tag, bm, mats)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    LOG.append(f"faces={len(ob.data.polygons)} tris={tris} verts={len(ob.data.vertices)}")
    shade_auto_smooth(ob, angle=40)

    def cam_shot(path, cam_pos, target, size=(1000, 800), fov=42.0, samples=24):
        sc = bpy.context.scene
        cam_data = bpy.data.cameras.new("_prev_cam")
        cam_data.angle = math.radians(fov)
        cam_data.clip_end = 3000.0
        cam = bpy.data.objects.new("_prev_cam", cam_data)
        sc.collection.objects.link(cam)
        cam.location = Vector(cam_pos)
        d = Vector(target) - Vector(cam_pos)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam
        sc.render.resolution_x, sc.render.resolution_y = size
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = 'PNG'
        sc.render.filepath = path
        prev = sc.cycles.samples
        sc.cycles.samples = samples
        sc.cycles.use_denoising = False
        bpy.ops.render.render(write_still=True)
        sc.cycles.samples = prev
        bpy.data.objects.remove(cam, do_unlink=True)
        bpy.data.cameras.remove(cam_data)
        return path

    def shots(suffix=""):
        cam_shot(OUT_DIR + f"/{tag}{suffix}_front.png", (0.5, -13.0, 4.2), (0, 0, 3.1), size=(1000, 800), fov=42)
        cam_shot(OUT_DIR + f"/{tag}{suffix}_quarter.png", (9.0, -10.0, 6.0), (0, 0, 3.0), size=(1000, 800), fov=42)
        cam_shot(OUT_DIR + f"/{tag}{suffix}_back.png", (-7.0, 11.0, 5.0), (0, 0, 3.0), size=(1000, 800), fov=42)

    if PREVIEW:
        shots("_pre")
        LOG.append("preview only")
    else:
        uv_project([ob], angle=60, island_margin=0.003)
        paths, imgs = bake_asset([ob], tag, size=2048, samples=20, ao_amount=0.5)
        LOG.append("baked")
        mat = baked_material(tag, imgs, emissive_strength=1.0)
        apply_baked([ob], mat)
        export_glb([ob], OUT_DIR + f"/{tag}.glb")
        LOG.append("exported " + OUT_DIR + f"/{tag}.glb")
        shots()
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
