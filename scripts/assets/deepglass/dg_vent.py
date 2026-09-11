# Deepglass boost vent, the housing around a fuel pad.
# Two nodes: a static cowl and a rotor the renderer spins.
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/deepglass/scripts/assets/deepglass/dg_lib.py").read())
    reset_scene()
    studio_lights()

    M_BRASS, M_DARK, M_RUNE, M_STONE = 0, 1, 2, 3

    def make_mats():
        return [
            mat_brass("vt_brass", scale=14.0, patina=0.22, rough_lo=0.18, rough_hi=0.44),
            mat_brass("vt_brass_dark", base=srgb(0x8a6529), dark=srgb(0x46331a),
                      scale=18.0, patina=0.36, rough_lo=0.30, rough_hi=0.62),
            mat_rune("vt_rune", srgb(0xd8ffe9), 5.5),
            mat_stone("vt_stone", STONE, STONE_DARK, scale=12.0, bump=0.32),
        ]

    mats = make_mats()
    objs = []

    # ---- cowl -------------------------------------------------------------
    # An OPEN frame, not a shroud. The pad's glow is the thing you spot from
    # across the bell; a solid bowl swallowed it and left a black tyre. Rune
    # inlay is confined to the hub lens for the same reason, at three yards
    # across, a glowing band anywhere else reads as a white blob, not detail.
    bm = bmesh.new()
    torus(bm, 1.44, 0.155, major=48, minor=10, mat=M_BRASS)
    torus(bm, 1.44, 0.055, major=44, minor=6, mat=M_DARK, center=(0, 0, 0.145))
    torus(bm, 1.44, 0.055, major=44, minor=6, mat=M_DARK, center=(0, 0, -0.145))

    # compass tabs: the silhouette that says "machine" at a distance
    for i in range(8):
        a = TAU * i / 8 + math.pi / 8
        rot = Matrix.Rotation(a, 3, 'Z')
        box(bm, (0.34, 0.30, 0.11), center=(math.cos(a) * 1.60, math.sin(a) * 1.60, 0.0),
            mat=M_DARK, rot=rot)
        box(bm, (0.13, 0.13, 0.16), center=(math.cos(a) * 1.70, math.sin(a) * 1.70, 0.0),
            mat=M_BRASS, rot=rot)

    # three struts to the hub
    for i in range(3):
        a = TAU * i / 3
        box(bm, (1.06, 0.14, 0.11), center=(math.cos(a) * 0.86, math.sin(a) * 0.86, 0.0),
            mat=M_DARK, rot=Matrix.Rotation(a, 3, 'Z'))
    lathe(bm, [(0.0, -0.16), (0.30, -0.16), (0.36, -0.05), (0.36, 0.05), (0.30, 0.16), (0.0, 0.16)],
          segs=20, mat=M_BRASS)
    for s in (1, -1):
        lathe(bm, [(0.0, 0.0), (0.24, 0.03 * s), (0.26, 0.10 * s), (0.0, 0.14 * s)],
              segs=18, mat=M_RUNE, origin=(0, 0, 0.10 * s))
    objs.append(new_obj("vent_cowl", bm, mats))

    # ---- rotor ------------------------------------------------------------
    rb = bmesh.new()
    torus(rb, 1.06, 0.05, major=40, minor=6, mat=M_DARK)
    for i in range(10):
        a = TAU * i / 10
        rot = Matrix.Rotation(a, 3, 'Z') @ Matrix.Rotation(math.radians(46), 3, 'X')
        box(rb, (0.44, 0.055, 0.40), center=(math.cos(a) * 1.06, math.sin(a) * 1.06, 0.0),
            mat=M_BRASS, rot=rot)
    objs.append(new_obj("vent_rotor", rb, make_mats()))

    LOG.append("objs " + ", ".join(f"{o.name}:{len(o.data.polygons)}" for o in objs))

    uv_project(objs, angle=62, island_margin=0.005)
    paths, imgs = bake_asset(objs, "vent", size=1024, samples=26, ao_amount=0.5)
    LOG.append("baked")
    mat = baked_material("vent", imgs, emissive_strength=1.0)
    apply_baked(objs, mat)
    export_glb(objs, OUT_DIR + "/boost_vent.glb")

    render_preview(OUT_DIR + "/vent_front.png", (3.0, -3.8, 1.9), (0, 0, 0), size=(860, 760), fov=44)
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
