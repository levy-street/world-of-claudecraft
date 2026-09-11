# Deepglass goal gate, the funnel the scoring ring hangs inside.
#
# Authored around +Z ("deeper into the goal"), origin ON the scoring plane, then
# rotated so +Z -> +X before export: the sim's ring planes are at world x = +-30
# and the render places this with a plain yaw flip per side.
#
# The rune inlay is baked NEAR-WHITE on purpose. three.js multiplies
# `material.emissive` by `emissiveMap`, so a greyscale mask lets one GLB serve
# both the amber west ring and the cyan east one.
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/deepglass/scripts/assets/deepglass/dg_lib.py").read())
    reset_scene()
    studio_lights()

    MOUTH_R = 19.5      # < the bell section radius at 4.2 in front of the plane
    MOUTH_Z = -4.2
    COLLAR_R = 6.6      # DG_RING_RADIUS 6 + clearance
    POCKET_Z = 4.0      # DG_POCKET_DEPTH
    RIBS = 12

    M_BRASS, M_DARK, M_RUNE, M_STONE = 0, 1, 2, 3
    mats = [
        mat_brass("gate_brass", scale=1.6, patina=0.26, rough_lo=0.20, rough_hi=0.50),
        mat_brass("gate_brass_dark", base=srgb(0x7d5a26), dark=srgb(0x3d2c14),
                  scale=2.2, patina=0.42, rough_lo=0.34, rough_hi=0.68),
        mat_rune("gate_rune", srgb(0xe6f8ff), 5.0),
        mat_stone("gate_stone", STONE, STONE_DARK, scale=1.4, bump=0.30),
    ]

    bm = bmesh.new()

    # ---- the mouth: a heavy hoop with a crown of swept fins ----------------
    torus(bm, MOUTH_R, 0.52, major=72, minor=10, mat=M_BRASS, center=(0, 0, MOUTH_Z))
    torus(bm, MOUTH_R - 0.78, 0.20, major=64, minor=8, mat=M_DARK, center=(0, 0, MOUTH_Z - 0.10))
    torus(bm, MOUTH_R + 0.74, 0.20, major=64, minor=8, mat=M_DARK, center=(0, 0, MOUTH_Z - 0.10))

    for i in range(24):
        a = TAU * i / 24
        rr = MOUTH_R + 0.50
        lathe(bm, [(0.11, 0.0), (0.16, 0.05), (0.13, 0.16), (0.0, 0.20)], segs=6, mat=M_BRASS,
              origin=(math.cos(a) * rr, math.sin(a) * rr, MOUTH_Z))

    # fins raking forward off the hoop, the silhouette that says "aim here"
    for i in range(RIBS):
        a = TAU * i / RIBS + math.pi / RIBS
        pts, radii = [], []
        N = 8
        for k in range(N):
            t = k / (N - 1)
            r = MOUTH_R + 0.2 + 2.3 * math.sin(t * 1.5)
            z = MOUTH_Z - 0.3 - 2.6 * t
            pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
            radii.append(0.34 * (1 - 0.72 * t) + 0.05)
        tube_along(bm, pts, 0.3, segs=6, mat=M_BRASS, radii=radii)

    # ---- ribs: mouth -> throat --------------------------------------------
    def rib_at(t):
        """Radius/height along a rib. One function so the tie hoops land exactly
        ON the ribs instead of floating near them."""
        e = t * t * (3 - 2 * t)
        return (MOUTH_R + (COLLAR_R + 0.5 - MOUTH_R) * e,
                MOUTH_Z + (0.0 - MOUTH_Z) * (t ** 0.86))

    for i in range(RIBS):
        a = TAU * i / RIBS
        pts, radii = [], []
        N = 16
        for k in range(N):
            t = k / (N - 1)
            r, z = rib_at(t)
            pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
            radii.append(0.50 * (1 - 0.46 * t) + 0.04)
        tube_along(bm, pts, 0.5, segs=8, mat=M_BRASS, radii=radii)

    # tie hoops threading every rib, the funnel's structure, and the thing the
    # rune beads have to sit on to read as fitted rather than floating
    for (t, tube, runes) in ((0.30, 0.24, True), (0.62, 0.20, True)):
        r, z = rib_at(t)
        torus(bm, r, tube, major=64, minor=8, mat=M_DARK, center=(0, 0, z))
        if runes:
            for i in range(RIBS):
                a = TAU * i / RIBS + math.pi / RIBS
                c = (math.cos(a) * r, math.sin(a) * r, z)
                box(bm, (0.42, 0.42, 0.42), center=c, mat=M_RUNE,
                    rot=Matrix.Rotation(a, 3, 'Z') @ Matrix.Rotation(math.radians(45), 3, 'X'))

    # ---- throat shell: a short cone of plate between the ribs --------------
    lathe(bm, [
        (COLLAR_R + 3.1, -1.28), (COLLAR_R + 1.5, -0.62),
        (COLLAR_R + 0.62, -0.16), (COLLAR_R + 0.55, 0.10),
    ], segs=64, mat=M_STONE, close_bottom=False, close_top=False)
    torus(bm, COLLAR_R + 1.5, 0.12, major=56, minor=6, mat=M_RUNE, center=(0, 0, -0.60))

    # ---- the collar the scoring ring hangs in ------------------------------
    torus(bm, COLLAR_R, 0.44, major=64, minor=10, mat=M_BRASS, center=(0, 0, 0))
    torus(bm, COLLAR_R + 0.46, 0.16, major=56, minor=8, mat=M_RUNE, center=(0, 0, 0.02))
    torus(bm, COLLAR_R - 0.42, 0.16, major=56, minor=8, mat=M_RUNE, center=(0, 0, 0.02))

    # eight sigil plates set into the collar
    for i in range(8):
        a = TAU * i / 8 + math.pi / 8
        c = (math.cos(a) * COLLAR_R, math.sin(a) * COLLAR_R, 0.0)
        rot = Matrix.Rotation(a, 3, 'Z')
        box(bm, (0.30, 1.05, 1.05), center=c, mat=M_BRASS, rot=rot)
        box(bm, (0.40, 0.52, 0.52),
            center=(math.cos(a) * (COLLAR_R + 0.02), math.sin(a) * (COLLAR_R + 0.02), 0.0),
            mat=M_RUNE, rot=rot @ Matrix.Rotation(math.radians(45), 3, 'X'))

    # ---- the pocket: a cage behind the plane where a scored ball settles ----
    for i in range(8):
        a = TAU * i / 8
        pts, radii = [], []
        N = 12
        for k in range(N):
            t = k / (N - 1)
            r = COLLAR_R * (1 - t) + 2.0 * t + 1.1 * math.sin(t * math.pi) * (1 - t)
            z = POCKET_Z * (t ** 0.9)
            pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
            radii.append(0.22 * (1 - 0.4 * t) + 0.03)
        tube_along(bm, pts, 0.2, segs=6, mat=M_DARK, radii=radii)
    torus(bm, 4.4, 0.16, major=48, minor=8, mat=M_DARK, center=(0, 0, POCKET_Z * 0.46))
    torus(bm, 2.05, 0.22, major=40, minor=8, mat=M_BRASS, center=(0, 0, POCKET_Z))
    lathe(bm, [(0.0, 0.0), (1.5, 0.10), (1.7, 0.34), (1.5, 0.56), (0.0, 0.66)],
          segs=32, mat=M_RUNE, origin=(0, 0, POCKET_Z + 0.10))

    # ---- rotate +Z -> +X so the GLB's axis matches the sim's ring plane ----
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                     matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))

    ob = new_obj("goal_gate", bm, mats)
    LOG.append(f"gate verts={len(ob.data.vertices)} faces={len(ob.data.polygons)}")

    uv_project([ob], angle=62, island_margin=0.003)
    paths, imgs = bake_asset([ob], "goal_gate", size=2048, samples=24, ao_amount=0.55)
    LOG.append("baked")
    mat = baked_material("goal_gate", imgs, emissive_strength=1.0)
    apply_baked([ob], mat)
    export_glb([ob], OUT_DIR + "/goal_gate.glb")

    render_preview(OUT_DIR + "/gate_front.png", (-58, -30, 22), (1, 0, 0), size=(900, 760), fov=42)
    render_preview(OUT_DIR + "/gate_axis.png", (-66, 0.01, 3), (0, 0, 0), size=(860, 860), fov=44)
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
