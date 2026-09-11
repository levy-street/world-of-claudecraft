# Dock deck, a flat square plank platform in the dock stairs' language
# (dg_dock_stairs.py): weathered planks on bearers, driven piles with iron
# bands, iron-capped corner posts with rope cleats. The deck stands at the
# stairs' landing height (RISE 4), so a deck butted against the stairs' head
# is one level floor; decks butt against each other on any side.
#
# VARIANTS (env DECK_VARIANT): open - corner posts only (tiles everywhere);
#                              rail - a rope rail along the +X edge (rotate
#                                     the placement to put it where you like).
#
# Authored in yards, nothing below z=0, origin at the centre. Collision: ONE
# flat walkable deck at 4, pile boxes under it (a swimmer under the dock meets
# the piles), the rail as a box on the rail variant.
#
# Headless: [DECK_VARIANT=open|rail] [PREVIEW=1] Blender -b --python <this>
import os
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/carve/scripts/assets/deepglass/dg_lib.py").read())
    OUT_DIR = "/Users/troy/Documents/woc/carve/tmp/asset_src/deepglass"
    os.makedirs(OUT_DIR, exist_ok=True)
    VARIANT = str(globals().get("VARIANT", os.environ.get("DECK_VARIANT", "open")))
    PREVIEW = bool(globals().get("PREVIEW", os.environ.get("PREVIEW", "") == "1"))
    reset_scene()
    studio_lights()

    S = 6.0                         # square side
    H = 4.0                         # deck top (the stairs' landing height)
    T_PLANK = 0.09
    BEAM_T, BEAM_D = 0.14, 0.55
    POST, POST_H = 0.15, 1.05
    PILE = 0.30
    HS = S / 2

    def mat_wood(name, base, dark, scale=1.0, rough=(0.55, 0.85)):
        mat = bpy.data.materials.new(name)
        nt, bsdf = _nodes(mat)
        tc = nt.nodes.new('ShaderNodeTexCoord'); tc.location = (-1400, 0)
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
        silver = nt.nodes.new('ShaderNodeMixRGB'); silver.location = (-380, 200)
        silver.blend_type = 'MIX'
        silver.inputs['Color2'].default_value = (0.36, 0.33, 0.28, 1)
        nt.links.new(ramp.outputs['Color'], silver.inputs['Color1'])
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
        mat_wood("dkd_plank", srgb(0x8a6a44), srgb(0x4a3520), scale=1.0),
        mat_wood("dkd_beam", srgb(0x5e4630), srgb(0x2e2015), scale=0.7, rough=(0.6, 0.9)),
        mat_brass("dkd_iron", base=srgb(0x3b3b3e), dark=srgb(0x1a1a1c), scale=6.0, patina=0.12, metallic=0.7),
        mat_stone("dkd_rope", srgb(0xb59a67), srgb(0x7d6743), scale=18.0, rough=(0.8, 1.0), bump=0.5),
    ]

    COLL = []
    DECKS = []

    def build(bm):
        def slab(size, z0, z1, mat, x=0.0, y=0.0):
            box(bm, (size[0], size[1], z1 - z0), center=(x, y, (z0 + z1) * 0.5), mat=mat)

        # ---- planks across Y, running along X (the stairs' landing planks run
        # across the flight, so a deck butted on the head reads the same) -------
        nplank = 12
        pw = S / nplank
        for k in range(nplank):
            slab((S, pw - 0.03), H - T_PLANK, H, M_PLANK, y=-HS + pw * (k + 0.5))
        # bearers: perimeter frame + two cross bearers
        zb0, zb1 = H - T_PLANK - BEAM_D, H - T_PLANK
        for sy in (-1, 1):
            slab((S, BEAM_T), zb0, zb1, M_BEAM, y=sy * (HS - BEAM_T / 2))
        for sx in (-1, 1):
            slab((BEAM_T, S - BEAM_T * 2), zb0, zb1, M_BEAM, x=sx * (HS - BEAM_T / 2))
        for x in (-S / 6, S / 6):
            slab((BEAM_T, S - BEAM_T * 2), zb0, zb1, M_BEAM, x=x)
        # ---- piles: four corners + centre pair, iron bands, cross braces ------
        piles = [(sx * (HS - PILE / 2 - 0.02), sy * (HS - PILE / 2 - 0.02)) for sx in (-1, 1) for sy in (-1, 1)]
        piles += [(0.0, sy * (HS - PILE / 2 - 0.02)) for sy in (-1, 1)]
        top = zb0 - 0.02
        for (px, py) in piles:
            slab((PILE, PILE), 0.0, top, M_BEAM, x=px, y=py)
            slab((PILE + 0.06, PILE + 0.06), top - 0.30, top - 0.22, M_IRON, x=px, y=py)
            COLL.append((px, py, 0.0, top, PILE / 2, PILE / 2))
        for sy in (-1, 1):   # a brace along each long side between the piles
            slab((S - PILE * 2, 0.12), top - 0.7, top - 0.5, M_BEAM, y=sy * (HS - PILE / 2 - 0.02))
        # ---- corner posts: iron cap + cleat, rope rail on the rail variant ------
        posts = [(sx * (HS - POST / 2), sy * (HS - POST / 2)) for sx in (-1, 1) for sy in (-1, 1)]
        for (px, py) in posts:
            slab((POST, POST), zb0, H + POST_H, M_BEAM, x=px, y=py)
            slab((POST + 0.04, POST + 0.04), H + POST_H - 0.06, H + POST_H, M_IRON, x=px, y=py)
            slab((0.20, 0.06), H + POST_H - 0.22, H + POST_H - 0.16, M_IRON, x=px, y=py + (0.03 + POST / 2) * (1 if py > 0 else -1))
        if VARIANT == "rail":
            xr = HS - POST / 2
            # a mid post, then two ropes sagging between the three posts
            slab((POST, POST), zb0, H + POST_H, M_BEAM, x=xr, y=0.0)
            slab((POST + 0.04, POST + 0.04), H + POST_H - 0.06, H + POST_H, M_IRON, x=xr, y=0.0)
            ys = [-(HS - POST / 2), 0.0, HS - POST / 2]
            for drop in (0.10, 0.50):
                for k in range(2):
                    ya, yb = ys[k], ys[k + 1]
                    pts = []
                    for j in range(9):
                        u = j / 8
                        pts.append(Vector((xr + 0.04, ya + (yb - ya) * u, H + POST_H - drop - 0.12 * math.sin(u * math.pi))))
                    tube_along(bm, pts, 0.045, segs=6, mat=M_ROPE)
            COLL.append((xr, 0.0, H, H + POST_H, POST / 2 + 0.06, HS))
        DECKS.append(dict(x=0.0, y=0.0, hx=HS, hy=HS, y0=H, y1=H))

    tag = "dock_deck" + ("" if VARIANT == "open" else "_" + VARIANT)
    bm = bmesh.new()
    build(bm)
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
    size = (max(xs) - min(xs), max(zs) - min(zs), max(ys) - min(ys))
    import json
    json.dump({
        'size': [round(s, 4) for s in size],
        'minY': round(min(zs), 4),
        'boxes': [dict(x=b[0], y=(b[2] + b[3]) * 0.5, z=-b[1], hx=b[4], hy=(b[3] - b[2]) * 0.5, hz=b[5]) for b in COLL],
        'ramps': [dict(x=d['x'], z=-d['y'], hx=d['hx'], hz=d['hy'], y0=d['y0'], y1=d['y1']) for d in DECKS],
    }, open(OUT_DIR + f"/{tag}.collision.json", 'w'), indent=1)
    LOG.append(f"variant {VARIANT} size={tuple(round(s, 2) for s in size)} minZ={round(min(zs), 2)} boxes={len(COLL)} decks={len(DECKS)}")
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
        cam_shot(OUT_DIR + f"/{tag}{suffix}_quarter.png", (-9.0, -10.0, 8.0), (0.0, 0, 3.0), size=(1000, 800), fov=42)

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
