# Deepglass powerup station, the reliquary that holds a prize orb.
#
# Symmetric top-to-bottom on purpose: one sits on the bell floor (you dive onto
# it and read it from above) and one at the crown (you climb and read it from
# below), so neither view can be the "back".
#
# Exported as FOUR named nodes. The three gimbals are separate so the renderer
# can counter-rotate them; everything shares one baked atlas.
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/deepglass/scripts/assets/deepglass/dg_lib.py").read())
    reset_scene()
    studio_lights()

    M_BRASS, M_DARK, M_RUNE, M_STONE = 0, 1, 2, 3

    def make_mats():
        return [
            mat_brass("st_brass", scale=7.0, patina=0.24, rough_lo=0.18, rough_hi=0.46),
            mat_brass("st_brass_dark", base=srgb(0x8a6529), dark=srgb(0x46331a),
                      scale=9.0, patina=0.38, rough_lo=0.30, rough_hi=0.62),
            mat_rune("st_rune", srgb(0xe8faff), 5.0),
            mat_stone("st_stone", STONE, STONE_DARK, scale=6.0, bump=0.34),
        ]

    mats = make_mats()
    objs = []

    # ---- frame: two opposed spires braced by four sweeping arms ------------
    bm = bmesh.new()
    for s in (1, -1):
        # spire: fluted cone from the shoulder out to a finial
        prof = [
            (0.86, 1.55), (0.92, 1.72), (0.80, 1.88), (0.74, 2.20),
            (0.60, 2.72), (0.46, 3.24), (0.38, 3.58), (0.40, 3.74),
            (0.30, 3.86), (0.18, 4.06),
        ]
        lathe(bm, [(r, z * s) for (r, z) in prof], segs=28, mat=M_STONE,
              close_bottom=False, close_top=False, smooth=True)
        # collar where the spire meets the cage
        torus(bm, 0.90, 0.10, major=32, minor=8, mat=M_BRASS, center=(0, 0, 1.62 * s))
        torus(bm, 0.62, 0.08, major=28, minor=8, mat=M_BRASS, center=(0, 0, 2.72 * s))
        # the lamp at the tip: this is what you spot from across the bell
        lathe(bm, [(0.0, 0.0), (0.30, 0.10), (0.34, 0.28), (0.24, 0.44), (0.0, 0.52)],
              segs=20, mat=M_RUNE, origin=(0, 0, 4.02 * s))
        for i in range(6):
            a = TAU * i / 6
            box(bm, (0.10, 0.10, 0.44),
                center=(math.cos(a) * 0.52, math.sin(a) * 0.52, 3.10 * s),
                mat=M_BRASS, rot=Matrix.Rotation(a, 3, 'Z'))

    # four buttress arms bowing out around the gimbals
    for i in range(4):
        a = TAU * i / 4 + math.pi / 4
        pts, radii = [], []
        N = 17
        for k in range(N):
            t = k / (N - 1)                      # 0 -> bottom shoulder, 1 -> top
            z = -1.70 + 3.40 * t
            r = 0.86 + 2.42 * math.sin(math.pi * t) ** 0.9
            pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
            radii.append(0.115 + 0.085 * math.sin(math.pi * t))
        tube_along(bm, pts, 0.12, segs=8, mat=M_BRASS, radii=radii)
        # a rune keystone at the arm's widest point
        box(bm, (0.30, 0.46, 0.62), center=(math.cos(a) * 3.30, math.sin(a) * 3.30, 0.0),
            mat=M_RUNE, rot=Matrix.Rotation(a, 3, 'Z'))
        box(bm, (0.22, 0.66, 0.86), center=(math.cos(a) * 3.20, math.sin(a) * 3.20, 0.0),
            mat=M_DARK, rot=Matrix.Rotation(a, 3, 'Z'))

    # the socket claws that "hold" the orb the sim hands out
    for i in range(6):
        a = TAU * i / 6
        for s in (1, -1):
            pts, radii = [], []
            N = 8
            for k in range(N):
                t = k / (N - 1)
                r = 0.30 + 1.05 * t
                z = s * (1.42 - 0.92 * t)
                pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
                radii.append(0.075 * (1 - 0.45 * t) + 0.015)
            tube_along(bm, pts, 0.07, segs=6, mat=M_BRASS, radii=radii)
    objs.append(new_obj("station_frame", bm, mats))

    # ---- three gimbals, each its own node so they can counter-rotate -------
    gimbals = (
        ("station_ring_a", 2.42, 0.105, 'Z', 12),
        ("station_ring_b", 2.14, 0.095, 'X', 10),
        ("station_ring_c", 1.88, 0.085, 'Y', 8),
    )
    for (name, R, tube, axis, beads) in gimbals:
        gb = bmesh.new()
        torus(gb, R, tube, major=64, minor=8, mat=M_BRASS, axis=axis)
        torus(gb, R, tube * 0.42, major=56, minor=6, mat=M_RUNE, axis=axis,
              center=(0, 0, 0))
        for i in range(beads):
            a = TAU * i / beads
            if axis == 'Z':
                c = (math.cos(a) * R, math.sin(a) * R, 0.0)
                rot = Matrix.Rotation(a, 3, 'Z')
            elif axis == 'X':
                c = (0.0, math.cos(a) * R, math.sin(a) * R)
                rot = Matrix.Rotation(a, 3, 'X') @ Matrix.Rotation(math.radians(90), 3, 'Z')
            else:
                c = (math.cos(a) * R, 0.0, math.sin(a) * R)
                rot = Matrix.Rotation(-a, 3, 'Y')
            box(gb, (0.30, 0.20, 0.20), center=c, mat=M_DARK, rot=rot)
        objs.append(new_obj(name, gb, make_mats()))

    LOG.append("objs " + ", ".join(f"{o.name}:{len(o.data.polygons)}" for o in objs))

    uv_project(objs, angle=62, island_margin=0.004)
    paths, imgs = bake_asset(objs, "station", size=1024, samples=26, ao_amount=0.5)
    LOG.append("baked")
    mat = baked_material("station", imgs, emissive_strength=1.0)
    apply_baked(objs, mat)
    export_glb(objs, OUT_DIR + "/powerup_station.glb")

    render_preview(OUT_DIR + "/station_front.png", (7.6, -9.0, 3.4), (0, 0, 0), size=(780, 900), fov=44)
    render_preview(OUT_DIR + "/station_top.png", (2.6, -3.0, 8.6), (0, 0, 0.4), size=(820, 820), fov=48)
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
