# The Warden's Hall, castle great hall. 10 x 15 footprint, stacked 5-tall
# castle walls (10 total), church A-frame roof, throne dais at the south end.
# Front faces +Y. S=2.0.
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/b3a5eb48-37dc-4429-b53c-25163d3a9b01/scratchpad/bl'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    exec(open(SCRATCH + '/bl_lite.py').read())
    FLOOR_DEFAULT = 'planks'
    reset_build()
    M = 2.5
    HX, HY = 5.0, 7.5
    S = 2.0

    # ---------------- shell (L0) ----------------
    for ix in range(4):
        for iy in range(6):
            use('buildings/Floor_01', -HX + M / 2 + ix * M, -HY + M / 2 + iy * M, 0.1, 0, 'L0')
    # Front (+Y): window, 5-wide arch, window; upper row above
    use('buildings/CastleWall_04', -3.75, HY, 0, 0, 'L0')
    use('buildings/CastleWall_06', 0, HY, 0, 0, 'L0')
    use('buildings/CastleWall_04', 3.75, HY, 0, 0, 'L0')
    use('buildings/CastleWall_01', -3.75, HY, 5, 0, 'L0')
    use('buildings/CastleWall_05', -1.25, HY, 5, 0, 'L0')
    use('buildings/CastleWall_05', 1.25, HY, 5, 0, 'L0')
    use('buildings/CastleWall_01', 3.75, HY, 5, 0, 'L0')
    # Doors
    use('buildings/CastleDoor_02', -0.95, HY - 0.15, 0, -2.35, 'L0')
    use('buildings/CastleDoor_03', 0.95, HY - 0.15, 0, 2.3, 'L0')
    # Back (-Y)
    for bx in (-3.75, -1.25, 1.25, 3.75):
        use('buildings/CastleWall_01', bx, -HY, 0, 0, 'L0')
        use('buildings/CastleWall_05' if abs(bx) > 2 else 'buildings/CastleWall_01', bx, -HY, 5, 0, 'L0')
    # Sides: gothic windows alternating, both storeys
    for i, sy in enumerate((-6.25, -3.75, -1.25, 1.25, 3.75, 6.25)):
        lower = 'buildings/CastleWall_04' if i % 2 == 0 else 'buildings/CastleWall_01'
        upper = 'buildings/CastleWall_05' if i % 2 == 0 else 'buildings/CastleWall_01'
        use(lower, -HX, sy, 0, math.pi / 2, 'L0')
        use(lower, HX, sy, 0, math.pi / 2, 'L0')
        use(upper, -HX, sy, 5, math.pi / 2, 'L0')
        use(upper, HX, sy, 5, math.pi / 2, 'L0')
    # Corners stacked
    for cx, cy in ((-HX, -HY), (-HX, HY), (HX, -HY), (HX, HY)):
        use('buildings/CastleCorner_01', cx, cy, 0, 0, 'L0')
        use('buildings/CastleCorner_02', cx, cy, 5, 0, 'L0')
    # Skirting front
    for bx in (-3.75, 3.75):
        use('buildings/CastleBase_02', bx, HY + 0.24, 0, 0, 'L0')

    # ---------------- the hall ----------------
    # Dais (south end): stone platform + grand steps + throne
    stone_slab(0, -6.15, 0.0, 2.7, 1.4, 0.355)
    stone_slab(0, -4.62, 0.0, 2.1, 0.25, 0.24)
    stone_slab(0, -4.98, 0.0, 2.4, 0.26, 0.2375)
    ramp(0, -4.5, 0.55, 2.1, -math.pi / 2, 0.2, 0.71)
    use('props/Throne_01', 0, -6.6, 0.72, math.pi, 'L0', s=1.35)  # backrest is +Y at rz 0: pi faces the door
    use('props/Candle_05', -2.0, -6.5, 0.72, 0.2, 'L0')
    use('props/Candle_05', 2.0, -6.5, 0.72, -0.2, 'L0')
    use('props/Carpet_03', 0, -6.15, 0.73, math.pi / 2, 'L0')
    # Blue carpet runner door -> dais
    for cy in (6.2, 3.6, 1.0, -1.6, -4.0):
        use('props/Carpet_04', 0, cy, 0.215, math.pi / 2, 'L0', sy=1.4, sx=1.38)
    # Candelabra pairs along the aisle
    for cy in (4.6, 1.6, -1.4):
        use('props/Candle_05', -1.75, cy, 0.2, 0, 'L0')
        use('props/Candle_05', 1.75, cy, 0.2, 0, 'L0')
    # Long feast tables + benches
    for sx_ in (-1, 1):
        use('props/Table_02', sx_ * 3.4, 1.8, 0.2, math.pi / 2, 'L0', sx=1.35)
        use('props/Table_02', sx_ * 3.4, -1.6, 0.2, math.pi / 2, 'L0', sx=1.35)
        # The BACK is on the piece's +y side at rz 0, so a bench east of the
        # table needs rz = -pi/2 to put its back east and its seat to the table.
        bench_rz = math.pi / 2 if sx_ < 0 else -math.pi / 2
        use('props/Furniture_14', sx_ * 2.55, 1.8, 0.2, bench_rz, 'L0')
        use('props/Furniture_14', sx_ * 2.55, -1.6, 0.2, bench_rz, 'L0')
    use('props/Carpet_03', -3.4, 1.8, 0.21, math.pi / 2, 'L0')
    use('props/Carpet_03', 3.4, -1.6, 0.21, math.pi / 2, 'L0')
    use('props/PlateFood_02', -3.35, 2.3, 0.88, 0.4, 'L0')
    use('props/Food_02', -3.45, 1.2, 0.88, 1.3, 'L0')
    use('props/Cup_03', 3.4, 1.5, 0.88, 0, 'L0')
    use('props/PlateFood_01', 3.35, -1.2, 0.88, 2.1, 'L0')
    use('props/Bottle_05', 3.45, -2.0, 0.88, 0, 'L0')
    # Hearth on the west wall
    use('buildings/Fireplace_01', -4.5, 3.9, 0.2, math.pi / 2, 'L0', s=1.5)
    use('props/Fire_01', -4.45, 3.9, 0.38, 0, 'L0', s=1.3)
    use('props/Firewood_01', -4.2, 2.6, 0.2, 0.8, 'L0')
    # Banners: sides between windows, pair behind the throne
    for by in (-5.0, -2.5, 0.0, 2.5, 5.0):
        use('props/Flag_02', -4.82, by, 6.8, math.pi / 2, 'L0')
        use('props/Flag_02', 4.82, by, 6.8, -math.pi / 2, 'L0')
    use('props/Flag_06', -1.6, -7.32, 7.2, 0, 'L0')
    use('props/Flag_06', 1.6, -7.32, 7.2, 0, 'L0')
    # Chandeliers down the axis
    for cy in (-3.6, 0.0, 3.6):
        use('props/Light_01', 0, cy, 8.6, 0, 'L0', s=1.5)
    # Shields + weapons display on the north wall inside
    use('props/Shield_03', -2.8, HY - 0.2, 3.6, math.pi, 'L0', s=1.3)
    use('props/Shield_03', 2.8, HY - 0.2, 3.6, math.pi, 'L0', s=1.3)

    # ---------------- exterior ----------------
    steps(0, HY + 0.3, 0, 6.8, 3, 0.2)
    use('props/Lantern_01', -3.3, HY + 0.9, 0, 0, 'L0', s=1.25)
    use('props/Lantern_01', 3.3, HY + 0.9, 0, math.pi, 'L0', s=1.25)
    use('props/Flag_06', -2.5, HY + 0.28, 8.6, math.pi, 'L0')
    use('props/Flag_06', 2.5, HY + 0.28, 8.6, math.pi, 'L0')

    # ---------------- roof (H2) ----------------
    # Recentered (mesh origin sits 1.158 units off along the ridge) and lifted
    # so the eaves land just over the wall tops with a real overhang.
    roof = use('buildings/ChurchRoof_01', 0, -1.135, 4.74, 0, 'H2', sx=0.98, sy=0.98, sz=0.95)
    # ChurchRoof_01's main A-frame stops at template y -3.553 and drops to a
    # lower back section with two side dormers, leaving the A-frame's end OPEN
    # (black interior from behind). Make it a proper church roof: drop the
    # lower section, and a second copy turned 180deg supplies the same
    # A-frame profile for the back half (cut where the two meet, world y
    # -4.62), so the ridge runs the full length with a gable at each end.
    cut_local_y(roof, -3.553, keep='above')
    roof2 = use('buildings/ChurchRoof_01', 0, 1.116, 4.74, math.pi, 'H2', sx=0.98, sy=0.98, sz=0.95)
    cut_local_y(roof2, 5.853, keep='above')   # local y > 5.853 == world y < -4.62
    retint_roof([roof, roof2])
    # Plank backing behind the glazed front truss + the matching back gable
    gable_solid(7.42, 10.0, 14.25, 5.12, axis='y', grp='H2')
    gable_solid(-7.42, 10.0, 14.25, 5.12, axis='y', grp='H2')

    # ---------------- collision ----------------
    T = 0.26
    col_wall(-HX, HY, -1.0, HY, 0, 10, T)
    col_wall(1.0, HY, HX, HY, 0, 10, T)
    col(0, HY, 6.75, 1.1, T, 3.3)  # arch lintel up through the upper wall
    col_wall(-HX, -HY, HX, -HY, 0, 10, T)
    col_wall(-HX, -HY, -HX, HY, 0, 10, T)
    col_wall(HX, -HY, HX, HY, 0, 10, T)
    # Dais plateau (walkable) + entry steps ramp + throne
    ramp(0, -6.3, 2.5, 1.2, 0, 0.71, 0.71)
    col(0, -6.75, 1.4, 0.75, 0.5, 1.4)  # throne
    col(-2.0, -6.5, 0.9, 0.25, 0.25, 0.9)
    col(2.0, -6.5, 0.9, 0.25, 0.25, 0.9)
    # Tables + benches
    for sx_ in (-1, 1):
        col(sx_ * 3.4, 1.8, 0.55, 0.55, 1.8, 0.55)
        col(sx_ * 3.4, -1.6, 0.55, 0.55, 1.8, 0.55)
        col(sx_ * 2.55, 1.8, 0.4, 0.3, 1.55, 0.4)
        col(sx_ * 2.55, -1.6, 0.4, 0.3, 1.55, 0.4)
    for cy in (4.6, 1.6, -1.4):
        col(-1.75, cy, 0.75, 0.22, 0.22, 0.75)
        col(1.75, cy, 0.75, 0.22, 0.22, 0.75)
    col(-4.5, 3.9, 2.2, 0.55, 1.3, 2.2)  # hearth

    col(-3.3, HY + 0.9, 1.55, 0.32, 0.32, 1.55)  # entrance lamp posts
    col(3.3, HY + 0.9, 1.55, 0.32, 0.32, 1.55)

    interior(-HX + 0.2, HX - 0.2, -HY + 0.2, HY - 0.2, 0.0, 10.0)

    plaster_exterior()
    # explorable: flat clean-tile floors, planar dissolve, slab decimation; no cull
    brass_ring(0, 0, HX, HY, 5.0, out=0.24)
    flatten_tiles()
    dissolve_planar()
    decimate_slabs()
    finalize('tidehold_hall', SCRATCH + '/out', S)
    render_shot(SCRATCH + '/hall_ext.png', (22, 34, 18), (0, 0, 9), w=1500, h=1000)
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(True)
    render_shot(SCRATCH + '/hall_int.png', (0, 12.5, 5.0), (0, -12, 1.5), w=1500, h=1000, fov=66)
    render_shot(SCRATCH + '/hall_int2.png', (-7.5, 6.5, 7.5), (6.5, -11, 0.5), w=1500, h=1000, fov=70)
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(False)
except Exception:
    print(traceback.format_exc())
