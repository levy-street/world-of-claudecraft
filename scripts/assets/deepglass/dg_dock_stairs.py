# Dock stairs, a weathered timber flight fit for a harbour: open-riser plank
# treads on two raking stringers, driven piles under the head, cleated posts
# with hemp rope rails and iron fittings, and a short plank landing at the
# top so the flight meets a dock deck.
#
# Authored in yards, NOTHING below z=0 (the loader seats the lowest vertex on
# the ground and the sidecar is measured from it), origin at the FOOT-TO-HEAD centre: the
# flight climbs along +X from x = -RUN/2 (foot, ground) to +RUN/2 (head, RISE),
# then the landing runs on to +RUN/2 + LAND. asset_scale.ts keeps it at
# authored yards (scale 1 = this size); rotate the placement to aim the climb.
#
# Collision sidecar (glTF frame, model yards): ONE walkable ramp deck along
# the flight (rising along local +X from y0 at the foot edge to y1 at the head
# edge, through the tread-top line) + a flat landing deck, and rail boxes
# down both sides. Nothing solid on the treads, so the player just walks up.
#
# Headless: [PREVIEW=1] Blender -b --python <this>
import os
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/carve/scripts/assets/deepglass/dg_lib.py").read())
    OUT_DIR = "/Users/troy/Documents/woc/carve/tmp/asset_src/deepglass"
    os.makedirs(OUT_DIR, exist_ok=True)
    PREVIEW = bool(globals().get("PREVIEW", os.environ.get("PREVIEW", "") == "1"))
    reset_scene()
    studio_lights()

    RUN, RISE, W = 6.0, 4.0, 3.0
    N = 10
    RISER, TREAD = RISE / N, RUN / N
    LAND = 1.6                      # landing length past the head
    T_PLANK = 0.09
    STR_T, STR_D = 0.14, 0.45       # stringer thickness / depth
    RAIL_H = 1.05                   # rope rail height above the tread line
    X0, X1 = -RUN / 2, RUN / 2

    def mat_wood(name, base, dark, scale=1.0, rough=(0.55, 0.85)):
        """Weathered planks: banded grain along X, silvered by noise."""
        mat = bpy.data.materials.new(name)
        nt, bsdf = _nodes(mat)
        tc = nt.nodes.new('ShaderNodeTexCoord'); tc.location = (-1400, 0)
        # stretch the grain along X
        mp = nt.nodes.new('ShaderNodeMapping'); mp.location = (-1200, 0)
        mp.inputs['Scale'].default_value = (0.35 * scale, 6.0 * scale, 6.0 * scale)
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        wave = nt.nodes.new('ShaderNodeTexWave'); wave.location = (-950, 200)
        wave.wave_type = 'BANDS'; wave.bands_direction = 'Y'
        wave.inputs['Scale'].default_value = 1.6
        wave.inputs['Distortion'].default_value = 4.5
        wave.inputs['Detail'].default_value = 3.0
        nt.links.new(mp.outputs['Vector'], wave.inputs['Vector'])
        n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.location = (-950, -200)
        n2.inputs['Scale'].default_value = 9.0 * scale
        n2.inputs['Detail'].default_value = 7.0
        nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.location = (-650, 200)
        ramp.color_ramp.elements[0].position = 0.25
        ramp.color_ramp.elements[0].color = dark
        ramp.color_ramp.elements[1].position = 0.75
        ramp.color_ramp.elements[1].color = base
        nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
        # silvering: noise lifts patches toward a grey driftwood tone
        silver = nt.nodes.new('ShaderNodeMixRGB'); silver.location = (-380, 200)
        silver.blend_type = 'MIX'
        silver.inputs['Color2'].default_value = (0.36, 0.33, 0.28, 1)
        nt.links.new(ramp.outputs['Color'], silver.inputs['Color1'])
        # only the high noise peaks silver, so the timber stays warm brown
        sv = nt.nodes.new('ShaderNodeMapRange'); sv.location = (-600, -60)
        sv.inputs['From Min'].default_value = 0.55
        sv.inputs['From Max'].default_value = 0.85
        sv.inputs['To Max'].default_value = 0.55
        nt.links.new(n2.outputs['Fac'], sv.inputs['Value'])
        nt.links.new(sv.outputs['Result'], silver.inputs['Fac'])
        nt.links.new(silver.outputs['Color'], bsdf.inputs['Base Color'])
        rr = nt.nodes.new('ShaderNodeMapRange'); rr.location = (-380, -100)
        rr.inputs['To Min'].default_value = rough[0]
        rr.inputs['To Max'].default_value = rough[1]
        nt.links.new(n2.outputs['Fac'], rr.inputs['Value'])
        nt.links.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
        bsdf.inputs['Metallic'].default_value = 0.0
        bmp = nt.nodes.new('ShaderNodeBump'); bmp.location = (0, -300)
        bmp.inputs['Strength'].default_value = 0.35
        bmp.inputs['Distance'].default_value = 0.04
        nt.links.new(wave.outputs['Fac'], bmp.inputs['Height'])
        nt.links.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])
        return mat

    M_PLANK, M_BEAM, M_IRON, M_ROPE = 0, 1, 2, 3
    mats = [
        mat_wood("dks_plank", srgb(0x8a6a44), srgb(0x4a3520), scale=1.0),
        mat_wood("dks_beam", srgb(0x5e4630), srgb(0x2e2015), scale=0.7, rough=(0.6, 0.9)),
        mat_brass("dks_iron", base=srgb(0x3b3b3e), dark=srgb(0x1a1a1c), scale=6.0, patina=0.12, metallic=0.7),
        mat_stone("dks_rope", srgb(0xb59a67), srgb(0x7d6743), scale=18.0, rough=(0.8, 1.0), bump=0.5),
    ]

    COLL = []    # (x, y, z0, z1, hx, hy) Blender frame
    DECKS = []   # dicts: x, y, hx, hy, y0, y1 (rise along +X)

    def build(bm):
        def slab(size, z0, z1, mat, x=0.0, y=0.0):
            box(bm, (size[0], size[1], z1 - z0), center=(x, y, (z0 + z1) * 0.5), mat=mat)

        def bolt(x, y, z, along_x=True):
            box(bm, (0.10, 0.05, 0.10) if along_x else (0.05, 0.10, 0.10), center=(x, y, z), mat=M_IRON)

        slope = math.atan2(RISE, RUN)
        # the tread-top line: z(x) = (x - X0) / RUN * RISE  (tread i top at (i+1)*RISER)
        # ---- stringers: raking beams under the tread noses --------------------
        # Trimmed inside the first and last tread and lifted so the foot corner
        # never dips under z=0 (the model base) and the head corner stays under
        # the top tread's lip.
        # (foot corner at +0.03, head corner 1 cm under the top tread's lip,
        # so the model base IS the foot and the landing sits exactly at RISE
        # above it - a butted dock_deck meets it level).
        length = math.hypot(RUN, RISE) - 0.7
        for sy in (-1, 1):
            y = sy * (W / 2 - STR_T / 2)
            rot = Matrix.Rotation(-slope, 3, 'Y')     # tilt +X up toward +Z
            box(bm, (length, STR_T, STR_D), center=(0.0, y, RISE / 2 + 0.02), mat=M_BEAM, rot=rot)
        # ---- treads: two planks each, cleats under, bolts through the stringers
        for i in range(N):
            xc = X0 + TREAD * (i + 0.5)
            zt = (i + 1) * RISER
            for k, sy in enumerate((-1, 1)):
                slab((TREAD - 0.05, W / 2 - 0.05), zt - T_PLANK, zt, M_PLANK, x=xc, y=sy * (W / 4))
            slab((TREAD - 0.16, W - STR_T * 2 - 0.1), zt - T_PLANK - 0.10, zt - T_PLANK, M_BEAM, x=xc)
            for sy in (-1, 1):
                bolt(xc, sy * (W / 2 + 0.01), zt - 0.20)
        # ---- landing: planks across, a header beam, two bearers ---------------
        LX0, LX1 = X1, X1 + LAND
        nplank = 6
        pw = (LX1 - LX0) / nplank
        for k in range(nplank):
            slab((pw - 0.03, W), RISE - T_PLANK, RISE, M_PLANK, x=LX0 + pw * (k + 0.5))
        for sy in (-1, 1):
            slab((LAND, STR_T), RISE - T_PLANK - STR_D, RISE - T_PLANK, M_BEAM, x=(LX0 + LX1) / 2, y=sy * (W / 2 - STR_T / 2))
        slab((STR_T, W), RISE - T_PLANK - STR_D, RISE - T_PLANK, M_BEAM, x=LX0 + STR_T / 2)
        slab((STR_T, W), RISE - T_PLANK - STR_D, RISE - T_PLANK, M_BEAM, x=LX1 - STR_T / 2)
        # ---- piles: driven timber under the upper flight and the landing -------
        PILE = 0.30
        for (px, top) in ((X0 + RUN * 0.55, RISE * 0.55 - 0.4), (X1 - 0.5, RISE - 0.45), (LX1 - 0.3, RISE - 0.45)):
            for sy in (-1, 1):
                slab((PILE, PILE), 0.0, top, M_BEAM, x=px, y=sy * (W / 2 - PILE / 2 - 0.02))
                # iron band near the top of each pile
                slab((PILE + 0.06, PILE + 0.06), top - 0.30, top - 0.22, M_IRON, x=px, y=sy * (W / 2 - PILE / 2 - 0.02))
            # cross brace between the piles
            slab((0.12, W - PILE * 2), top - 0.7, top - 0.5, M_BEAM, x=px)
        # ---- posts + rope rails ------------------------------------------------
        POST = 0.15
        post_x = [X0 + 0.12, X0 + RUN / 3, X0 + 2 * RUN / 3, X1 - 0.12, LX1 - 0.12]
        post_top = []
        for px in post_x:
            zl = min(RISE, max(0.0, (px - X0) / RUN * RISE)) if px <= X1 else RISE
            ztop = zl + RAIL_H
            post_top.append(ztop)
            for sy in (-1, 1):
                y = sy * (W / 2 - POST / 2)
                base = 0.0 if px < X1 - 0.5 else zl - STR_D - 0.2
                slab((POST, POST), base, ztop, M_BEAM, x=px, y=y)
                slab((POST + 0.04, POST + 0.04), ztop - 0.06, ztop, M_IRON, x=px, y=y)   # iron cap
                # cleat: an iron horn for the rope
                slab((0.20, 0.06), ztop - 0.22, ztop - 0.16, M_IRON, x=px, y=y + sy * (POST / 2 + 0.03))
        # ropes: sagging catenaries between post tops (top + waist ropes)
        for sy in (-1, 1):
            y = sy * (W / 2 - POST / 2 + POST / 2 + 0.04)
            for drop in (0.10, 0.50):
                for k in range(len(post_x) - 1):
                    xa, xb = post_x[k], post_x[k + 1]
                    za, zb = post_top[k] - drop, post_top[k + 1] - drop
                    pts = []
                    for j in range(9):
                        u = j / 8
                        sag = 0.12 * math.sin(u * math.pi)
                        pts.append(Vector((xa + (xb - xa) * u, y, za + (zb - za) * u - sag)))
                    tube_along(bm, pts, 0.045, segs=6, mat=M_ROPE)
        # ---- collision ------------------------------------------------------------
        # Walk line through the tread tops: at the foot edge x = X0 the line is
        # half a riser up (tread 0's top is at RISER, its centre a half tread in),
        # at the head edge it is RISE + half a riser, so each tread CENTRE sits
        # exactly on the deck and a foot never sinks more than half a riser.
        DECKS.append(dict(x=0.0, y=0.0, hx=RUN / 2, hy=W / 2 - POST, y0=RISER * 0.5, y1=RISE + RISER * 0.5))
        DECKS.append(dict(x=(LX0 + LX1) / 2, y=0.0, hx=LAND / 2, hy=W / 2 - POST, y0=RISE, y1=RISE))
        for sy in (-1, 1):
            COLL.append(((X0 + LX1) / 2, sy * (W / 2 - POST / 2), 0.0, RISE + RAIL_H, (LX1 - X0) / 2, POST / 2 + 0.06))

    tag = "dock_stairs"
    bm = bmesh.new()
    build(bm)
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
    size = (max(xs) - min(xs), max(zs) - min(zs), max(ys) - min(ys))
    import json
    json.dump({
        'size': [round(s, 4) for s in size],
        'minY': round(min(zs), 4),
        'boxes': [dict(x=b[0], y=(b[2] + b[3]) * 0.5, z=-b[1], hx=b[4], hy=(b[3] - b[2]) * 0.5, hz=b[5]) for b in COLL],
        # ramps rise along local +X from y0 (x - hx) to y1 (x + hx)
        'ramps': [dict(x=d['x'], z=-d['y'], hx=d['hx'], hz=d['hy'], y0=d['y0'], y1=d['y1']) for d in DECKS],
    }, open(OUT_DIR + f"/{tag}.collision.json", 'w'), indent=1)
    LOG.append(f"size={tuple(round(s, 2) for s in size)} minZ={round(min(zs), 2)} boxes={len(COLL)} decks={len(DECKS)}")
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
        cam_shot(OUT_DIR + f"/{tag}{suffix}_quarter.png", (-6.0, -10.0, 5.5), (0.5, 0, 2.0), size=(1000, 800), fov=42)
        cam_shot(OUT_DIR + f"/{tag}{suffix}_side.png", (0.5, -12.0, 3.0), (0.5, 0, 2.2), size=(1000, 700), fov=40)
        cam_shot(OUT_DIR + f"/{tag}{suffix}_foot.png", (-8.5, 0.0, 1.6), (0.0, 0, 2.2), size=(1000, 800), fov=50)

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
