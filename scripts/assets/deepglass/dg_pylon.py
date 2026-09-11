# Deepglass cradle pylon, the 16 buttresses that carry the bell.
# Authored Z-up, origin on the base ring's top face, ~8.7 units tall (yd).
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/deepglass/scripts/assets/deepglass/dg_lib.py").read())
    reset_scene()
    studio_lights()

    H = 8.7                     # glassHeightAt(DEEPGLASS_CRADLE_R)
    M_STONE, M_DARK, M_BRASS, M_RUNE = 0, 1, 2, 3
    mats = [
        mat_stone("dg_stone", STONE, STONE_DARK, scale=5.0, bump=0.34),
        mat_stone("dg_stone_dark", STONE_DARK, srgb(0x4a463f), scale=7.0, bump=0.42),
        mat_brass("dg_brass", scale=8.0, patina=0.30),
        mat_rune("dg_rune", RUNE_CYAN, 4.0),
    ]

    bm = bmesh.new()

    # ---- plinth + socle: a stepped base, chamfered so it reads carved -------
    lathe(bm, [
        (1.52, 0.00), (1.52, 0.34), (1.40, 0.46),
        (1.40, 0.62), (1.26, 0.74),
    ], segs=16, mat=M_DARK, smooth=False, close_top=False)
    lathe(bm, [
        (1.26, 0.74), (1.26, 0.92), (1.06, 1.06),
        (1.02, 1.30), (1.06, 1.44), (1.00, 1.52),
    ], segs=32, mat=M_STONE, close_bottom=False, close_top=False)
    torus(bm, 1.44, 0.10, major=36, minor=8, mat=M_BRASS, center=(0, 0, 0.54))

    # ---- fluted shaft ------------------------------------------------------
    SHAFT_Z0, SHAFT_Z1 = 1.52, 6.10
    FLUTES = 16
    SEGS = 64
    RINGS = 24
    BELTS = ((2.62, 0.88), (4.46, 0.76))

    def shaft_r(t):
        # entasis: a real column swells slightly instead of tapering linearly
        r0, r1 = 0.97, 0.63
        swell = 0.045 * math.sin(math.pi * min(1.0, t * 1.05))
        return r0 + (r1 - r0) * (t ** 1.12) + swell

    def flute(a):
        # wide, shallow-bottomed grooves: cos^0.9 keeps the groove open instead
        # of pinching to a line that smooth shading then erases
        g = 0.5 + 0.5 * math.cos(a * FLUTES)
        return g ** 0.9

    rings = []
    for k in range(RINGS + 1):
        t = k / RINGS
        z = SHAFT_Z0 + (SHAFT_Z1 - SHAFT_Z0) * t
        fade = min(1.0, t / 0.07) * min(1.0, (1.0 - t) / 0.07)
        R = shaft_r(t)
        ring = []
        for i in range(SEGS):
            a = TAU * i / SEGS
            r = R * (1.0 - 0.135 * flute(a) * fade)
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for k in range(RINGS):
        A, B = rings[k], rings[k + 1]
        for i in range(SEGS):
            j = (i + 1) % SEGS
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            f.material_index = M_STONE
            f.smooth = True

    # brass belts: banded collars with rivet bosses
    for bz, br in BELTS:
        torus(bm, br + 0.035, 0.085, major=40, minor=8, mat=M_BRASS, center=(0, 0, bz))
        torus(bm, br + 0.035, 0.085, major=40, minor=8, mat=M_BRASS, center=(0, 0, bz + 0.22))
        for i in range(8):
            a = TAU * i / 8 + 0.2
            rr = br + 0.09
            lathe(bm, [(0.055, 0.0), (0.075, 0.03), (0.055, 0.075)], segs=6, mat=M_BRASS,
                  origin=(math.cos(a) * rr, math.sin(a) * rr, bz + 0.11))

    # ---- rune conduits -----------------------------------------------------
    # Four inlays sunk in the deepest flutes, BROKEN at each brass belt so the
    # light reads as channelled through the column rather than painted on it.
    spans = [(SHAFT_Z0 + 0.26, BELTS[0][0] - 0.14),
             (BELTS[0][0] + 0.36, BELTS[1][0] - 0.14),
             (BELTS[1][0] + 0.36, SHAFT_Z1 - 0.22)]
    for i in range(4):
        a = TAU * i / 4
        for (z0, z1) in spans:
            pts, radii = [], []
            N = 8
            for k in range(N):
                u = k / (N - 1)
                z = z0 + (z1 - z0) * u
                tt = (z - SHAFT_Z0) / (SHAFT_Z1 - SHAFT_Z0)
                r = shaft_r(tt) * (1.0 - 0.135) + 0.016
                pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
                radii.append(0.052 + 0.022 * math.sin(u * math.pi))
            tube_along(bm, pts, 0.05, segs=6, mat=M_RUNE, radii=radii)
        # a lozenge boss at the mid-point of the middle span: the "sigil"
        zc = (spans[1][0] + spans[1][1]) * 0.5
        tt = (zc - SHAFT_Z0) / (SHAFT_Z1 - SHAFT_Z0)
        rr = shaft_r(tt) * (1.0 - 0.135)
        c = Vector((math.cos(a) * rr, math.sin(a) * rr, zc))
        rot = Matrix.Rotation(a, 3, 'Z') @ Matrix.Rotation(math.radians(45), 3, 'X')
        box(bm, (0.10, 0.24, 0.24), center=tuple(c + Vector((math.cos(a), math.sin(a), 0)) * 0.03),
            mat=M_RUNE, rot=rot)

    # ---- necking + capital -------------------------------------------------
    torus(bm, 0.655, 0.075, major=36, minor=8, mat=M_BRASS, center=(0, 0, 6.14))
    lathe(bm, [
        (0.63, 6.10), (0.70, 6.26), (0.70, 6.42),
        (0.82, 6.64), (0.99, 6.90), (1.14, 7.10),
        (1.21, 7.24), (1.21, 7.30), (1.32, 7.46),
        (1.32, 7.64), (1.18, 7.74),
    ], segs=32, mat=M_STONE, close_bottom=False, close_top=False)
    torus(bm, 1.23, 0.075, major=40, minor=8, mat=M_BRASS, center=(0, 0, 7.27))
    # dentils tucked UNDER the abacus lip, where a cornice actually carries them
    for i in range(16):
        a = TAU * i / 16
        box(bm, (0.20, 0.115, 0.145),
            center=(math.cos(a) * 1.255, math.sin(a) * 1.255, 7.385),
            mat=M_STONE, rot=Matrix.Rotation(a, 3, 'Z'))

    # ---- the claw: four brass talons closing on the glass ------------------
    for i in range(4):
        a = TAU * i / 4 + math.pi / 4
        pts, radii = [], []
        N = 12
        for k in range(N):
            t = k / (N - 1)
            r = 1.06 * (1 - t) + 0.30 * t + 0.10 * math.sin(t * math.pi)
            z = 7.68 + (H - 7.68) * (t ** 0.82)
            pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
            radii.append(0.155 * (1 - 0.58 * t) + 0.028)
        tube_along(bm, pts, 0.14, segs=8, mat=M_BRASS, radii=radii)
        lathe(bm, [(0.0, 0.0), (0.075, 0.02), (0.075, 0.07), (0.0, 0.10)], segs=8,
              mat=M_RUNE, origin=(math.cos(a) * 0.31, math.sin(a) * 0.31, H - 0.06))
        # a strut back to the abacus so the talon reads as braced, not glued on
        p0 = Vector((math.cos(a) * 1.02, math.sin(a) * 1.02, 7.72))
        p1 = Vector((math.cos(a) * 0.72, math.sin(a) * 0.72, 8.16))
        tube_along(bm, [p0, (p0 + p1) * 0.5, p1], 0.055, segs=6, mat=M_BRASS)

    torus(bm, 0.62, 0.10, major=32, minor=8, mat=M_BRASS, center=(0, 0, 7.80))
    # the seat: a glowing lens where the glass actually lands
    lathe(bm, [(0.0, 0.0), (0.40, 0.06), (0.46, 0.20), (0.40, 0.30), (0.0, 0.34)],
          segs=24, mat=M_RUNE, origin=(0, 0, H - 0.30))

    ob = new_obj("pylon", bm, mats)
    LOG.append(f"pylon verts={len(ob.data.vertices)} faces={len(ob.data.polygons)}")

    uv_project([ob], angle=60, island_margin=0.004)
    paths, imgs = bake_asset([ob], "pylon", size=1024, samples=28, ao_amount=0.5)
    LOG.append("baked")
    mat = baked_material("pylon", imgs, emissive_strength=1.0)
    apply_baked([ob], mat)
    export_glb([ob], OUT_DIR + "/pylon.glb")

    render_preview(OUT_DIR + "/pylon_front.png", (7.5, -9.5, 6.2), (0, 0, 4.4), size=(700, 900))
    render_preview(OUT_DIR + "/pylon_top.png", (3.0, -3.4, 10.8), (0, 0, 7.6), size=(760, 760), fov=48)
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
