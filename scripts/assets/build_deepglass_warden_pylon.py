# Deepglass Warden pylon: the "colossi" the Tidehold citadel stands at its gate,
# along the boulevard and at the bridge heads (citadel.ts places it by HEIGHT,
# so this keeps the old cradle_pylon envelope exactly: 3.05 x 8.77 x 3.05 yd,
# origin at the foot). A clean tapered stone tower on a stepped plinth, two
# brass bands and a brass neck, four glowing rune slits between the bands, a
# flared crown and a crystal finial. Run HEADLESS:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/build_deepglass_warden_pylon.py
# (exporting over the BlenderMCP bridge crashes Blender 5.1.)
import bpy, bmesh, math, os, sys, traceback
OUT = '/Users/troy/Documents/woc/carve/public/models/deepglass/warden_pylon.glb'
PREVIEW = os.environ.get('PYLON_PREVIEW', '')
W = 3.05      # footprint (matches cradle_pylon bbox)
HGT = 8.77    # total height
log = []
try:
    scene = bpy.context.scene
    for o in list(scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    coll = scene.collection

    def mat(n, rgb, metallic, rough, emit=None, strength=0.0):
        m = bpy.data.materials.get(n) or bpy.data.materials.new(n)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Metallic'].default_value = metallic
        bsdf.inputs['Roughness'].default_value = rough
        if emit is not None:
            bsdf.inputs['Emission Color'].default_value = (*emit, 1)
            bsdf.inputs['Emission Strength'].default_value = strength
        return m
    stone = mat('PylonStone', (0.74, 0.72, 0.67), 0.0, 0.78)
    dark = mat('PylonStoneDark', (0.46, 0.45, 0.43), 0.0, 0.85)
    brass = mat('PylonBrass', (0.82, 0.62, 0.28), 0.9, 0.36)
    rune = mat('PylonRune', (0.55, 0.85, 1.0), 0.0, 0.3, emit=(0.70, 0.93, 1.0), strength=4.0)
    parts = []

    def add(bm_fn, n, m):
        bm = bmesh.new()
        bm_fn(bm)
        me = bpy.data.meshes.new(n)
        bm.to_mesh(me); bm.free()
        me.materials.append(m)
        o = bpy.data.objects.new(n, me)
        coll.objects.link(o)
        parts.append(o)
        return o

    def box(bm, sx, y0, y1, sz, bevel=0.03, cx=0.0, cz=0.0, rot=0.0):
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(sx, sz, y1 - y0), verts=bm.verts)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect='EDGES')
        if rot:
            import mathutils
            bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=mathutils.Matrix.Rotation(rot, 3, 'Z'), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(cx, cz, (y0 + y1) / 2), verts=bm.verts)
    def prism(bm, r, y0, y1, seg=8, bevel=0.03, rot=math.pi / 8):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=y1 - y0)
        import mathutils
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=mathutils.Matrix.Rotation(rot, 3, 'Z'), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(0, 0, (y0 + y1) / 2), verts=bm.verts)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect='EDGES')
    def taper(bm, r0, r1, y0, y1, seg=40, smooth=True, cap=True):
        bmesh.ops.create_cone(bm, cap_ends=cap, segments=seg, radius1=r0, radius2=r1, depth=y1 - y0)
        bmesh.ops.translate(bm, vec=(0, 0, (y0 + y1) / 2), verts=bm.verts)
        for f in bm.faces:
            f.smooth = smooth and abs(f.normal.z) < 0.5
    def torus(bm, major, minor, y, seg=40, rings=10):
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring = []
            for j in range(rings):
                b = 2 * math.pi * j / rings
                r = major + minor * math.cos(b)
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), y + minor * math.sin(b))))
            verts.append(ring)
        for i in range(seg):
            for j in range(rings):
                a, b = verts[i][j], verts[i][(j + 1) % rings]
                c, d = verts[(i + 1) % seg][(j + 1) % rings], verts[(i + 1) % seg][j]
                bm.faces.new((a, b, c, d))
        for f in bm.faces: f.smooth = True
    def band(bm, r, y0, y1, seg=40):
        # a brass collar: a cylinder with a chamfered top and bottom lip
        taper(bm, r, r, y0 + 0.06, y1 - 0.06, seg, cap=False)
        bm2 = bm
        bmesh.ops.create_cone(bm2, cap_ends=False, segments=seg, radius1=r - 0.06, radius2=r, depth=0.06)
        bmesh.ops.translate(bm2, vec=(0, 0, y0 + 0.03), verts=[v for v in bm2.verts if abs(v.co.z) <= 0.031])
        bmesh.ops.create_cone(bm2, cap_ends=False, segments=seg, radius1=r, radius2=r - 0.06, depth=0.06)
        bmesh.ops.translate(bm2, vec=(0, 0, y1 - 0.03), verts=[v for v in bm2.verts if abs(v.co.z) <= 0.031])
        for f in bm.faces: f.smooth = True

    # shaft radius as a function of height (a gentle taper with a flared foot)
    R_FOOT, R_TOP = 1.10, 0.80
    Y_SHAFT0, Y_SHAFT1 = 0.85, 7.30
    def r_at(y):
        t = (y - Y_SHAFT0) / (Y_SHAFT1 - Y_SHAFT0)
        return R_FOOT + (R_TOP - R_FOOT) * t

    # --- plinth: square base, octagonal step, flared foot ------------------------
    add(lambda bm: box(bm, W, 0.00, 0.32, W, 0.05), 'plinth', dark)
    add(lambda bm: prism(bm, 1.28, 0.32, 0.62, 8, 0.04), 'step', stone)
    add(lambda bm: taper(bm, 1.32, R_FOOT, 0.62, Y_SHAFT0, 40), 'foot_flare', stone)
    # --- shaft in three drums between the two bands ----------------------------
    BAND_A = (3.05, 3.50)
    BAND_B = (5.65, 6.05)
    add(lambda bm: taper(bm, r_at(Y_SHAFT0), r_at(BAND_A[0]), Y_SHAFT0, BAND_A[0], 40), 'drum_low', stone)
    add(lambda bm: taper(bm, r_at(BAND_A[1]), r_at(BAND_B[0]), BAND_A[1], BAND_B[0], 40), 'drum_mid', stone)
    add(lambda bm: taper(bm, r_at(BAND_B[1]), r_at(Y_SHAFT1), BAND_B[1], Y_SHAFT1, 40), 'drum_high', stone)
    add(lambda bm: band(bm, r_at(BAND_A[0]) + 0.10, *BAND_A), 'band_low', brass)
    add(lambda bm: band(bm, r_at(BAND_B[0]) + 0.10, *BAND_B), 'band_high', brass)
    # --- rune slits: four per drum, recessed dark channel + glowing core ----------
    def slits(bm, y0, y1, glow):
        for k in range(4):
            a = k * math.pi / 2
            rm = r_at((y0 + y1) / 2)
            if glow:
                w, d, out = 0.12, 0.10, 0.03
            else:
                w, d, out = 0.24, 0.14, 0.015
            cx, cz = math.cos(a) * (rm - d / 2 + out), math.sin(a) * (rm - d / 2 + out)
            bmesh.ops.create_cube(bm, size=1.0)
            new = [v for v in bm.verts if v.select] if False else list(bm.verts)[-8:]
            bmesh.ops.scale(bm, vec=(d, w, y1 - y0), verts=new)
            import mathutils
            bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=mathutils.Matrix.Rotation(a, 3, 'Z'), verts=new)
            bmesh.ops.translate(bm, vec=(cx, cz, (y0 + y1) / 2), verts=new)
    for (y0, y1, n) in [(1.35, 2.75, 'low'), (3.85, 5.35, 'mid'), (6.35, 7.05, 'high')]:
        add(lambda bm, y0=y0, y1=y1: slits(bm, y0, y1, False), f'slit_frame_{n}', dark)
        add(lambda bm, y0=y0, y1=y1: slits(bm, y0 + 0.08, y1 - 0.08, True), f'slit_glow_{n}', rune)
    # --- crown: brass neck, flared echinus, octagonal cap, crystal finial -----------
    add(lambda bm: torus(bm, R_TOP + 0.02, 0.07, Y_SHAFT1 + 0.04, 40, 8), 'neck', brass)
    add(lambda bm: taper(bm, R_TOP, 1.18, Y_SHAFT1 + 0.10, 7.80, 40), 'echinus', stone)
    add(lambda bm: prism(bm, 1.30, 7.80, 8.10, 8, 0.03), 'cap', dark)
    add(lambda bm: torus(bm, 1.05, 0.05, 8.12, 40, 8), 'cap_ring', brass)
    add(lambda bm: taper(bm, 0.30, 0.06, 8.10, HGT, 8, smooth=False), 'finial', rune)
    add(lambda bm: taper(bm, 0.36, 0.30, 8.10, 8.22, 8, smooth=False), 'finial_seat', brass)

    tris = 0
    for o in parts:
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    log.append(f'parts={len(parts)} tris~{tris}')

    if PREVIEW:
        cam = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cam); coll.objects.link(co)
        co.location = (11.0, -13.0, 6.5)
        import mathutils
        co.rotation_euler = (mathutils.Vector((0, 0, HGT / 2)) - co.location).to_track_quat('-Z', 'Y').to_euler()
        cam.lens = 45
        scene.camera = co
        sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.5
        so = bpy.data.objects.new('sun', sun); coll.objects.link(so)
        so.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'MATERIAL'
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
        scene.render.resolution_x, scene.render.resolution_y = 900, 1200
        scene.render.filepath = PREVIEW
        bpy.ops.render.render(write_still=True)
        log.append(f'preview {PREVIEW}')
        bpy.data.objects.remove(co, do_unlink=True); bpy.data.objects.remove(so, do_unlink=True)

    for o in parts:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_animations=False)
    log.append(f'exported {OUT} bytes={os.path.getsize(OUT)}')
except Exception:
    log.append(traceback.format_exc())
print('\n'.join(log))
