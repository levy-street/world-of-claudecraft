# Tidehold plot sign: the for-sale post at a housing plot's gate (Troy,
# 2026-09-08: "a plot sign that players will interact with to buy the home").
# Warden palette: a dark beam post with a brass-capped cross arm, a hanging
# plank board on two brass chains reading FOR SALE (raised letters, both faces),
# a small brass plaque on the post. Authored yards; the post foot at z=0.
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

    # Geometry rule (Troy, 2026-09-08: "the sign is clipping into itself and
    # the text is being obscured"): the board hangs ENTIRELY outboard of the
    # post, its near edge stops BOARD_GAP short of the post face, and the
    # knee braces live in two vertical planes just outside the post's sides,
    # so nothing ever crosses the board face. The arm always reaches past the
    # board's far edge; both are asserted below rather than eyeballed.
    POST, POST_H = 0.16, 2.45
    ARM_W, ARM_T = 0.19, 0.13          # arm: width across the sign, thickness
    BOARD_W, BOARD_H, BOARD_T = 1.32, 0.76, 0.06
    BOARD_GAP = 0.16                   # clear air between post face and board
    CHAIN = 0.30
    BRACE_X = POST / 2 + 0.005         # brace planes, just off the post faces

    # board centre and span along -Y (the sign's front is -Y, exported as -Z)
    board_near = -(POST / 2 + BOARD_GAP)
    yb = board_near - BOARD_W / 2
    board_far = yb - BOARD_W / 2
    ARM_L = abs(board_far) + 0.19 + POST / 2   # arm overhangs the board's far edge
    assert BRACE_X > BOARD_T / 2 + 0.02, "brace would cross the board face"
    assert board_near < -POST / 2, "board would clip the post"

    def mat_wood(name, base, dark, scale=1.0, rough=(0.55, 0.85)):
        mat = bpy.data.materials.new(name)
        nt, bsdf = _nodes(mat)
        tc = nt.nodes.new('ShaderNodeTexCoord'); tc.location = (-1400, 0)
        mp = nt.nodes.new('ShaderNodeMapping'); mp.location = (-1200, 0)
        mp.inputs['Scale'].default_value = (6.0 * scale, 0.35 * scale, 6.0 * scale)
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        wave = nt.nodes.new('ShaderNodeTexWave'); wave.location = (-950, 200)
        wave.wave_type = 'BANDS'; wave.bands_direction = 'X'
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
        nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
        rr = nt.nodes.new('ShaderNodeMapRange'); rr.location = (-380, -100)
        rr.inputs['To Min'].default_value = rough[0]
        rr.inputs['To Max'].default_value = rough[1]
        nt.links.new(n2.outputs['Fac'], rr.inputs['Value'])
        nt.links.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
        bsdf.inputs['Metallic'].default_value = 0.0
        bmp = nt.nodes.new('ShaderNodeBump'); bmp.location = (0, -300)
        bmp.inputs['Strength'].default_value = 0.3
        bmp.inputs['Distance'].default_value = 0.03
        nt.links.new(wave.outputs['Fac'], bmp.inputs['Height'])
        nt.links.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])
        return mat

    M_BEAM, M_PLANK, M_BRASS, M_LETTER = 0, 1, 2, 3
    mats = [
        mat_wood("pls_beam", srgb(0x5e4630), srgb(0x2e2015), scale=0.7, rough=(0.6, 0.9)),
        mat_wood("pls_plank", srgb(0xa07d4f), srgb(0x5a3f26), scale=1.0),
        mat_brass("pls_brass", scale=9.0),
        mat_brass("pls_letter", base=srgb(0xf0d27a), dark=srgb(0x9a7a30), scale=12.0, rough_lo=0.2, rough_hi=0.4),
    ]

    COLL = []

    def slab(bm, size, z0, z1, mat, x=0.0, y=0.0):
        box(bm, (size[0], size[1], z1 - z0), center=(x, y, (z0 + z1) * 0.5), mat=mat)

    bm = bmesh.new()
    # post + brass cap
    slab(bm, (POST, POST), 0.0, POST_H, M_BEAM)
    slab(bm, (POST + 0.05, POST + 0.05), POST_H - 0.05, POST_H + 0.03, M_BRASS)
    # cross arm out over the board, its underside the chain seat
    arm_z1 = POST_H - 0.09
    arm_z0 = arm_z1 - ARM_T
    slab(bm, (ARM_W, ARM_L), arm_z0, arm_z1, M_BEAM, y=-(ARM_L / 2 - POST / 2))
    slab(bm, (ARM_W + 0.04, 0.06), arm_z0 - 0.01, arm_z1 + 0.01, M_BRASS, y=-(ARM_L - POST / 2 - 0.05))
    # Knee braces: SHORT, and they stop before the board starts. A brace that
    # runs out over the board reads as a batten across the face from any
    # oblique angle (the first cut did exactly that), so each one lives in the
    # chain gap: it rises from the post to the arm inside the first 0.5 yd,
    # and its lowest point over the board's near edge is asserted clear of the
    # board top. Two of them, one either side, so the chains pass between.
    brace_y1 = -0.58
    brace_z0 = arm_z0 - 0.32
    brace_r = 0.032
    # the board, hung on two chains under the arm
    zb1 = arm_z0 - CHAIN
    zb0 = zb1 - BOARD_H
    brace_z_at_board = brace_z0 + ((abs(board_near) - POST / 2) / (abs(brace_y1) - POST / 2)) * (arm_z0 - 0.005 - brace_z0)
    assert brace_z_at_board - brace_r > zb1, "knee brace would cross the board face"
    for sx in (-1, 1):
        tube_along(bm, [
            Vector((sx * BRACE_X, -POST / 2, brace_z0)),
            Vector((sx * BRACE_X, brace_y1, arm_z0 - 0.005)),
        ], brace_r, segs=6, mat=M_BEAM)
    slab(bm, (BOARD_T, BOARD_W), zb0, zb1, M_PLANK, y=yb)
    for edge in (yb - BOARD_W / 2 + 0.025, yb + BOARD_W / 2 - 0.025):
        slab(bm, (BOARD_T + 0.025, 0.05), zb0 - 0.012, zb1 + 0.012, M_BRASS, y=edge)
    for sy in (-1, 1):
        ya = yb + sy * (BOARD_W / 2 - 0.14)
        tube_along(bm, [Vector((0.0, ya, zb1)), Vector((0.0, ya, arm_z0))], 0.018, segs=6, mat=M_BRASS)
        slab(bm, (0.07, 0.07), arm_z0 - 0.03, arm_z0 + 0.01, M_BRASS, y=ya)
    # brass plaque low on the post's +X face, clear of the braces and the board
    slab(bm, (0.02, 0.30), 0.78, 1.05, M_BRASS, x=POST / 2 + 0.01)
    slab(bm, (0.012, 0.16), 0.83, 0.93, M_BEAM, x=POST / 2 + 0.032)
    COLL.append((0.0, 0.0, 0.0, POST_H + 0.03, POST / 2 + 0.02, POST / 2 + 0.02))
    COLL.append((0.0, yb, zb0, zb1, BOARD_T / 2 + 0.03, BOARD_W / 2))
    ob = new_obj("plot_sign", bm, mats)

    # raised letters on both faces of the board
    def letters(text, x_face, sign):
        cu = bpy.data.curves.new("pls_txt", type='FONT')
        cu.body = text
        cu.size = 0.165
        cu.extrude = 0.012
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        to = bpy.data.objects.new("pls_txt", cu)
        bpy.context.scene.collection.objects.link(to)
        # text lies in its local XY; stand it up in the YZ plane facing +-X
        to.rotation_euler = (math.radians(90), 0.0, math.radians(90) * sign)
        to.location = (x_face, yb, (zb0 + zb1) * 0.5 - 0.01)
        dg = bpy.context.evaluated_depsgraph_get()
        me = to.evaluated_get(dg).to_mesh()
        mesh = bpy.data.meshes.new("pls_txt_mesh")
        b2 = bmesh.new(); b2.from_mesh(me)
        b2.transform(to.matrix_world)
        b2.to_mesh(mesh); b2.free()
        to.evaluated_get(dg).to_mesh_clear()
        bpy.data.objects.remove(to, do_unlink=True)
        lo = bpy.data.objects.new("pls_letters", mesh)
        mesh.materials.append(mats[M_LETTER])
        bpy.context.scene.collection.objects.link(lo)
        return lo

    lets = [letters("FOR SALE", BOARD_T / 2 + 0.002, 1), letters("FOR SALE", -BOARD_T / 2 - 0.002, -1)]
    activate([ob] + lets)
    with bpy.context.temp_override(**ctx_override()):
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = "plot_sign"

    tag = "plot_sign"
    xs = [v.co.x for v in ob.data.vertices]; ys = [v.co.y for v in ob.data.vertices]; zs = [v.co.z for v in ob.data.vertices]
    size = (max(xs) - min(xs), max(zs) - min(zs), max(ys) - min(ys))
    import json
    json.dump({
        'size': [round(s, 4) for s in size],
        'minY': round(min(zs), 4),
        'boxes': [dict(x=b[0], y=(b[2] + b[3]) * 0.5, z=-b[1], hx=b[4], hy=(b[3] - b[2]) * 0.5, hz=b[5]) for b in COLL],
        'ramps': [],
    }, open(OUT_DIR + f"/{tag}.collision.json", 'w'), indent=1)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    LOG.append(f"size={tuple(round(s, 3) for s in size)} minZ={round(min(zs), 3)} boxes={len(COLL)} faces={len(ob.data.polygons)} tris={tris}")
    shade_auto_smooth(ob, angle=40)

    def cam_shot(path, cam_pos, target, size=(900, 900), fov=38.0, samples=24):
        sc = bpy.context.scene
        cam_data = bpy.data.cameras.new("_prev_cam")
        cam_data.angle = math.radians(fov)
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

    def shots(suffix=""):
        cam_shot(OUT_DIR + f"/{tag}{suffix}_front.png", (3.2, -2.6, 2.0), (0.0, -0.85, 1.55))
        cam_shot(OUT_DIR + f"/{tag}{suffix}_side.png", (0.4, -4.2, 1.9), (0.0, -0.85, 1.6))

    if PREVIEW:
        shots("_pre")
        LOG.append("preview only")
    else:
        uv_project([ob], angle=60, island_margin=0.003)
        paths, imgs = bake_asset([ob], tag, size=1024, samples=20, ao_amount=0.5)
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
