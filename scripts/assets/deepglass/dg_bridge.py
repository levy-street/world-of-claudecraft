# Deepglass warden bridge kit, square deck modules on LONG piers, in the
# Warden Wall / Tower language (mottled grey stone, dark chamfered socles,
# riveted brass straps, cyan rune conduits + sigils). Building blocks for a
# maker to span Tidehold's fjords in Studio: butt modules end to end along X.
#
# Envelope: L (12) along X x WD (12) across Y, deck walking surface at Z_DECK
# above the pier FEET (origin = ground at the module centre). The piers are
# long on purpose: Tidehold's sea floor is -55 and the market ward stands at
# +30; the 70 yd piers (Troy: "a bit shorter") put a seabed-seated deck at
# +15, a Q/E nudge below the ward.
#
# VARIANTS (env BRIDGE_VARIANT or a prepended VARIANT = "..."):
#   deck   - plain span: deck, parapets, two piers with collars + cross braces
#   lamp   - the span with a rune lamp post on each parapet at mid-module
#   pylon  - the piers carry on above the deck as twin gate towers with a
#            brass-strapped lintel over the walkway (rhythm piece)
#
# Collision sidecar (<tag>.collision.json, glTF frame, MODEL YARDS): the
# walking surface is a flat DECK (ramp y0 == y1) so a grounded mover strides
# onto it; parapets, piers, towers and the lintel are boxes. Install with
# scripts/assets/deepglass/install_bridge.mjs, which relies on the
# asset_scale.ts rule that keeps these modules at authored yards (norm 1).
#
# Headless: /Applications/Blender.app/Contents/MacOS/Blender -b --python <this>
# PREVIEW=1 (env or prepended) skips the bake and renders Cycles preview shots.
import os
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/carve/scripts/assets/deepglass/dg_lib.py").read())
    OUT_DIR = "/Users/troy/Documents/woc/carve/tmp/asset_src/deepglass"
    os.makedirs(OUT_DIR, exist_ok=True)
    VARIANT = str(globals().get("VARIANT", os.environ.get("BRIDGE_VARIANT", "deck")))
    PREVIEW = bool(globals().get("PREVIEW", os.environ.get("PREVIEW", "") == "1"))
    reset_scene()
    studio_lights()

    # ---- envelope -----------------------------------------------------------
    L, WD = 12.0, 12.0               # module length (X, tiles) x deck width (Y)
    Z_DECK = 70.0                    # walking surface above the pier feet
    DECK_T = 2.0                     # slab thickness
    PIER_Y, PIER_S = 4.5, 2.8        # pier centre offset across, square section
    PAR_Y, PAR_D, PAR_H = 5.5, 0.80, 1.55     # parapet centre, depth, body height
    TOWER_Y, TOWER_S, TOWER_H = 4.9, 2.9, 8.0  # pylon towers above the deck

    M_STONE, M_DARK, M_BRASS, M_RUNE = 0, 1, 2, 3
    mats = [
        mat_stone("dgb_stone", STONE, STONE_DARK, scale=3.2, bump=0.30),
        mat_stone("dgb_stone_dark", STONE_DARK, srgb(0x4a463f), scale=4.5, bump=0.38),
        mat_brass("dgb_brass", scale=5.0, patina=0.28),
        mat_rune("dgb_rune", RUNE_CYAN, 1.2),
    ]

    COLL = []    # (x, y, z0, z1, hx, hy) Blender frame, model yards
    DECKS = []   # (x, y, hx, hy, z) flat walkable decks

    def build(bm):
        def slab(size, z0, z1, mat, x=0.0, y=0.0):
            box(bm, (size[0], size[1], z1 - z0), center=(x, y, (z0 + z1) * 0.5), mat=mat)

        def rivet(x, y, z, along_x=True):
            box(bm, (0.16, 0.07, 0.16) if along_x else (0.07, 0.16, 0.16), center=(x, y, z), mat=M_BRASS)

        def collar(x, y, s, z0, z1, proud=0.07, rivets=2):
            """A brass strap round a square section (s x s at x,y), rivets on
            every face."""
            slab((s + proud * 2, s + proud * 2), z0, z1, M_BRASS, x=x, y=y)
            zc = (z0 + z1) * 0.5
            for k in range(rivets):
                u = (k + 0.5) / rivets - 0.5
                for sg in (-1, 1):
                    rivet(x + u * s * 0.8, y + sg * (s / 2 + proud + 0.03), zc)
                    rivet(x + sg * (s / 2 + proud + 0.03), y + u * s * 0.8, zc, along_x=False)

        def lozenge(x, y, z, size=0.30, axis='Y'):
            rot = Matrix.Rotation(math.radians(45), 3, axis)
            if axis == 'Y':
                box(bm, (size, 0.07, size), center=(x, y, z), mat=M_RUNE, rot=rot)
            else:
                box(bm, (size, size, 0.06), center=(x, y, z), mat=M_RUNE, rot=rot)

        def conduit_x(x0, x1, y, z, r=0.045, n=7):
            pts, radii = [], []
            for k in range(n):
                u = k / (n - 1)
                pts.append(Vector((x0 + (x1 - x0) * u, y, z)))
                radii.append(r + r * 0.5 * math.sin(u * math.pi))
            tube_along(bm, pts, r, segs=6, mat=M_RUNE, radii=radii)

        Z_SLAB0 = Z_DECK - DECK_T
        Z_CAP0 = Z_SLAB0 - 2.4

        # ---- piers: socle, shaft with brass collars, flared capital ---------
        for sy in (-1, 1):
            py = sy * PIER_Y
            slab((PIER_S + 1.0, PIER_S + 1.0), 0.00, 0.90, M_DARK, y=py)
            slab((PIER_S + 0.6, PIER_S + 0.6), 0.90, 1.60, M_DARK, y=py)
            slab((PIER_S, PIER_S), 1.50, Z_CAP0 + 0.05, M_STONE, y=py)
            for zc in (12.0, 26.0, 40.0, 54.0):
                collar(0.0, py, PIER_S, zc - 0.28, zc + 0.28)
                # rune verticals up the outer face between collars
                pts = [Vector((0.0, py + sy * (PIER_S / 2 + 0.01), z)) for z in (zc + 2.2, zc + 7.0, zc + 11.8)]
                tube_along(bm, pts, 0.05, segs=6, mat=M_RUNE, radii=[0.04, 0.062, 0.04])
                lozenge(0.0, py + sy * (PIER_S / 2 + 0.03), zc + 7.0, 0.34)
            # capital
            slab((PIER_S + 0.30, PIER_S + 0.30), Z_CAP0, Z_CAP0 + 0.7, M_STONE, y=py)
            slab((PIER_S + 0.70, PIER_S + 0.70), Z_CAP0 + 0.7, Z_CAP0 + 1.4, M_STONE, y=py)
            slab((PIER_S + 0.50, PIER_S + 0.50), Z_CAP0 + 1.4, Z_CAP0 + 1.7, M_BRASS, y=py)
            slab((PIER_S + 1.0, PIER_S + 1.0), Z_CAP0 + 1.7, Z_SLAB0 + 0.02, M_DARK, y=py)
            COLL.append((0.0, py, 0.0, Z_SLAB0, PIER_S / 2 + 0.5, PIER_S / 2 + 0.5))

        # ---- cross bracing between the piers --------------------------------
        inner = PIER_Y - PIER_S / 2
        for zc in (18.0, 40.0, 60.0):
            slab((0.9, inner * 2 + 0.2), zc - 0.5, zc + 0.5, M_DARK)
        # diagonal X braces in the two upper bays (reads as ironwork)
        for (bay0, bay1) in ((18.5, 39.5), (40.5, 59.5)):
            span = math.hypot(inner * 2, bay1 - bay0)
            ang = math.atan2(bay1 - bay0, inner * 2)
            for sg in (-1, 1):
                rot = Matrix.Rotation(sg * ang, 3, 'X')
                box(bm, (0.5, span, 0.5), center=(0.0, 0.0, (bay0 + bay1) * 0.5), mat=M_BRASS, rot=rot)

        # ---- bearer beam + deck slab + cornice lip --------------------------
        slab((PIER_S + 0.7, WD - 0.6), Z_SLAB0 - 0.9, Z_SLAB0, M_DARK)
        for sy in (-1, 1):   # longitudinal edge beams under the slab edges
            slab((L, 0.7), Z_SLAB0 - 0.6, Z_SLAB0, M_STONE, y=sy * (WD / 2 - 0.35))
            slab((L, 0.20), Z_SLAB0 - 0.42, Z_SLAB0 - 0.18, M_BRASS, y=sy * (WD / 2 + 0.02))
        slab((L, WD - 0.4), Z_SLAB0, Z_DECK - 0.35, M_STONE)
        slab((L, WD), Z_DECK - 0.35, Z_DECK, M_STONE)         # cornice lip = walkway
        for sy in (-1, 1):   # dentils under the lip
            for k in range(15):
                x = -L / 2 + L * (k + 0.5) / 15
                box(bm, (0.30, 0.26, 0.24), center=(x, sy * (WD / 2 - 0.13), Z_DECK - 0.48), mat=M_STONE)
        COLL.append((0.0, 0.0, Z_SLAB0 - 0.9, Z_DECK - 0.05, L / 2, WD / 2))
        DECKS.append((0.0, 0.0, L / 2, WD / 2, Z_DECK))

        # walkway: dark kerbs along the parapets + a rune channel down the middle
        for sy in (-1, 1):
            slab((L, 0.30), Z_DECK, Z_DECK + 0.05, M_DARK, y=sy * (PAR_Y - PAR_D / 2 - 0.15))
        conduit_x(-L / 2, L / 2, 0.0, Z_DECK + 0.02, r=0.05, n=9)
        lozenge(0.0, 0.0, Z_DECK + 0.03, 0.42, axis='Z')

        # ---- parapets: sill, body, brass strap, merlons, rune conduits ------
        for sy in (-1, 1):
            py = sy * PAR_Y
            slab((L, PAR_D + 0.20), Z_DECK, Z_DECK + 0.12, M_DARK, y=py)
            slab((L, PAR_D), Z_DECK + 0.12, Z_DECK + PAR_H, M_STONE, y=py)
            slab((L, PAR_D + 0.10), Z_DECK + PAR_H, Z_DECK + PAR_H + 0.10, M_BRASS, y=py)
            zc = Z_DECK + PAR_H + 0.05
            for x in (-4.5, -1.5, 1.5, 4.5):
                for sg in (-1, 1):
                    rivet(x, py + sg * (PAR_D / 2 + 0.08), zc)
            for x in (-4.5, -1.5, 1.5, 4.5):
                slab((1.8, PAR_D - 0.06), Z_DECK + PAR_H + 0.10, Z_DECK + PAR_H + 0.50, M_STONE, x=x, y=py)
                slab((1.9, PAR_D + 0.02), Z_DECK + PAR_H + 0.50, Z_DECK + PAR_H + 0.58, M_BRASS, x=x, y=py)
                slab((1.7, PAR_D - 0.14), Z_DECK + PAR_H + 0.58, Z_DECK + PAR_H + 0.66, M_STONE, x=x, y=py)
            for sg in (-1, 1):   # rune conduit on both faces, sigil at mid-module
                yf = py + sg * (PAR_D / 2 + 0.01)
                conduit_x(-L / 2 + 0.3, -0.45, yf, Z_DECK + 0.85)
                conduit_x(0.45, L / 2 - 0.3, yf, Z_DECK + 0.85)
                lozenge(0.0, py + sg * (PAR_D / 2 + 0.03), Z_DECK + 0.85, 0.40)
            COLL.append((0.0, py, Z_DECK - 0.05, Z_DECK + PAR_H + 0.66, L / 2, PAR_D / 2 + 0.10))

        # ---- lamp variant: rune lamp posts at mid-module ---------------------
        if VARIANT == "lamp":
            for sy in (-1, 1):
                py = sy * PAR_Y
                z0 = Z_DECK + PAR_H + 0.10
                lathe(bm, [(0.0, 0.0), (0.26, 0.0), (0.26, 0.14), (0.14, 0.18), (0.14, 3.00),
                           (0.20, 3.04), (0.20, 3.20), (0.0, 3.20)],
                      segs=10, mat=M_BRASS, origin=(0.0, py, z0))
                # arm reaching over the walkway, orb hung under it
                slab((0.16, 1.1), z0 + 3.00, z0 + 3.16, M_BRASS, y=py - sy * 0.55)
                oz = z0 + 2.55
                lathe(bm, [(0.0, -0.30), (0.20, -0.22), (0.30, 0.0), (0.20, 0.22), (0.0, 0.30)],
                      segs=12, mat=M_RUNE, origin=(0.0, py - sy * 1.10, oz))
                torus(bm, 0.30, 0.035, major=16, minor=5, mat=M_BRASS, center=(0.0, py - sy * 1.10, oz))
                slab((0.12, 0.12), oz + 0.28, z0 + 3.00, M_BRASS, y=py - sy * 1.10)
                COLL.append((0.0, py, Z_DECK + PAR_H, z0 + 3.2, 0.28, 0.28))

        # ---- pylon variant: twin gate towers + lintel ------------------------
        if VARIANT == "pylon":
            zt0 = Z_DECK
            zt1 = Z_DECK + TOWER_H
            for sy in (-1, 1):
                ty = sy * TOWER_Y
                slab((TOWER_S + 0.6, TOWER_S + 0.6), zt0 - 0.05, zt0 + 0.45, M_DARK, y=ty)
                slab((TOWER_S + 0.3, TOWER_S + 0.3), zt0 + 0.45, zt0 + 0.75, M_DARK, y=ty)
                slab((TOWER_S, TOWER_S), zt0 + 0.70, zt1, M_STONE, y=ty)
                collar(0.0, ty, TOWER_S, zt0 + 0.95, zt0 + 1.10, rivets=3)
                collar(0.0, ty, TOWER_S, zt1 - 0.55, zt1 - 0.40, rivets=3)
                # rune conduits on the walkway-facing and outer faces
                for sg in (-1, 1):
                    yf = ty + sg * (TOWER_S / 2 + 0.01)
                    pts = [Vector((0.0, yf, z)) for z in (zt0 + 1.8, zt0 + 4.0, zt0 + 6.2)]
                    tube_along(bm, pts, 0.05, segs=6, mat=M_RUNE, radii=[0.04, 0.064, 0.04])
                    lozenge(0.0, ty + sg * (TOWER_S / 2 + 0.03), zt0 + 4.0, 0.38)
                # crown: cornice, merlons at the corners, brass collar + lens
                slab((TOWER_S + 0.30, TOWER_S + 0.30), zt1, zt1 + 0.25, M_STONE, y=ty)
                slab((TOWER_S + 0.60, TOWER_S + 0.60), zt1 + 0.25, zt1 + 0.50, M_STONE, y=ty)
                for mx in (-1, 1):
                    for my in (-1, 1):
                        slab((0.70, 0.70), zt1 + 0.50, zt1 + 1.15, M_STONE,
                             x=mx * (TOWER_S / 2 - 0.05), y=ty + my * (TOWER_S / 2 - 0.05))
                        slab((0.76, 0.76), zt1 + 1.15, zt1 + 1.22, M_BRASS,
                             x=mx * (TOWER_S / 2 - 0.05), y=ty + my * (TOWER_S / 2 - 0.05))
                slab((1.0, 1.0), zt1 + 0.50, zt1 + 0.95, M_DARK, y=ty)
                torus(bm, 0.42, 0.06, major=20, minor=6, mat=M_BRASS, center=(0.0, ty, zt1 + 0.98))
                lathe(bm, [(0.0, 0.0), (0.36, 0.04), (0.40, 0.12), (0.32, 0.20), (0.0, 0.26)],
                      segs=16, mat=M_RUNE, origin=(0.0, ty, zt1 + 0.96))
                COLL.append((0.0, ty, zt0 - 0.05, zt1 + 1.22, TOWER_S / 2 + 0.30, TOWER_S / 2 + 0.30))
            # lintel over the walkway, strapped, sigil on both faces
            zl0, zl1 = zt0 + 6.6, zt0 + 7.6
            slab((TOWER_S - 0.2, TOWER_Y * 2), zl0, zl1, M_STONE)
            slab((TOWER_S - 0.1, TOWER_Y * 2 - TOWER_S + 0.1), zl0 + 0.32, zl0 + 0.48, M_BRASS)
            for sg in (-1, 1):
                xf = sg * ((TOWER_S - 0.2) / 2 + 0.03)
                rot = Matrix.Rotation(math.radians(45), 3, 'X')
                box(bm, (0.07, 0.42, 0.42), center=(xf, 0.0, (zl0 + zl1) * 0.5), mat=M_RUNE, rot=rot)
                for y in (-1.2, 1.2):
                    box(bm, (0.07, 0.16, 0.16), center=(xf, y, zl0 + 0.40), mat=M_BRASS)
            COLL.append((0.0, 0.0, zl0, zl1, (TOWER_S - 0.2) / 2, TOWER_Y))

    tag = "bridge_" + VARIANT
    bm = bmesh.new()
    build(bm)
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
    size = (max(xs) - min(xs), max(zs) - min(zs), max(ys) - min(ys))   # glTF x, y(up), z
    import json
    json.dump({
        'size': [round(s, 4) for s in size],
        'minY': round(min(zs), 4),
        'boxes': [dict(x=b[0], y=(b[2] + b[3]) * 0.5, z=-b[1], hx=b[4], hy=(b[3] - b[2]) * 0.5, hz=b[5]) for b in COLL],
        'ramps': [dict(x=d[0], z=-d[1], hx=d[2], hz=d[3], y0=d[4], y1=d[4]) for d in DECKS],
    }, open(OUT_DIR + f"/{tag}.collision.json", 'w'), indent=1)
    LOG.append(f"variant {VARIANT} size={tuple(round(s, 2) for s in size)} boxes={len(COLL)} decks={len(DECKS)}")
    ob = new_obj(tag, bm, mats)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    LOG.append(f"faces={len(ob.data.polygons)} tris={tris} verts={len(ob.data.vertices)}")
    shade_auto_smooth(ob, angle=40)

    def cam_shot(path, cam_pos, target, size=(800, 1000), fov=40.0, samples=24):
        """Headless-safe preview: a camera + a short Cycles render (the offscreen
        GPU path is unavailable under -b)."""
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
        H = Z_DECK
        cam_shot(OUT_DIR + f"/{tag}{suffix}_deck.png", (19.0, -22.0, H + 9.5), (0, 0, H + 1.6), size=(1000, 800), fov=42)
        cam_shot(OUT_DIR + f"/{tag}{suffix}_walk.png", (-14.0, 0.0, H + 2.2), (6, 0, H + 1.6), size=(1000, 800), fov=60)
        cam_shot(OUT_DIR + f"/{tag}{suffix}_full.png", (60.0, -85.0, 36.0), (0, 0, H * 0.5), size=(700, 1100), fov=42)

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
