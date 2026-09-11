# The Gilded Gull, rebuilt BIGGER, Tidehold's meeting hall. Front faces +Y
# (exports to -Z). Footprint 12.5 x 10 kit units (5 x 4 modules), ground walls
# 3 tall, 2F walls 3 tall, gable roof scaled to the wider span. S = 1.85.
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/b3a5eb48-37dc-4429-b53c-25163d3a9b01/scratchpad/bl'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    exec(open(SCRATCH + '/bl_lite.py').read())
    FLOOR_DEFAULT = 'planks'
    reset_build()
    M = 2.5
    HX, HY = 6.25, 5.0
    S = 1.85
    XS = (-5.0, -2.5, 0.0, 2.5, 5.0)
    YS = (-3.75, -1.25, 1.25, 3.75)

    # ---------------- ground floor (L0) ----------------
    for x in XS:
        for y in YS:
            use('buildings/Floor_04', x, y, 0.1, 0, 'L0')
    # Front wall (+Y): window, plain, DOOR (centred), plain, window
    for x, piece in zip(XS, ('HouseWall_13', 'HouseWall_02', 'HouseWall_08', 'HouseWall_02', 'HouseWall_11')):
        use('buildings/' + piece, x, HY, 0, 0, 'L0')
    use('buildings/HouseDoor_01', -0.53, HY - 0.1, 0.0, -2.55, 'L0')  # ajar, hinge at west jamb
    # Back wall (-Y)
    for x, piece in zip(XS, ('HouseWall_06', 'HouseWall_02', 'HouseWall_06', 'HouseWall_02', 'HouseWall_12')):
        use('buildings/' + piece, x, -HY, 0, 0, 'L0')
    # West side: windows + the fireplace bay; east side: the stair side, one window
    for y, piece in zip(YS, ('HouseWall_11', 'HouseWall_02', 'HouseWall_02', 'HouseWall_11')):
        use('buildings/' + piece, -HX, y, 0, math.pi / 2, 'L0')
    for y, piece in zip(YS, ('HouseWall_11', 'HouseWall_02', 'HouseWall_02', 'HouseWall_02')):
        use('buildings/' + piece, HX, y, 0, math.pi / 2, 'L0')
    for cx, cy in ((-HX, -HY), (-HX, HY), (HX, -HY), (HX, HY)):
        use('buildings/Corner_04', cx, cy, 0, 0, 'L0')
    for x in (-5.0, -2.5, 2.5, 5.0):
        use('buildings/HouseBase_01', x, HY + 0.16, 0, 0, 'L0')
    # Wainscot inside along the back + west walls
    for x in XS:
        use('buildings/HouseBase_01', x, -HY + 0.18, 0, math.pi, 'L0')
    for y in (-3.75, -1.25):
        use('buildings/HouseBase_01', -HX + 0.18, y, 0, -math.pi / 2, 'L0')

    # Hearth on the west wall
    use('buildings/Fireplace_01', -HX + 0.45, 1.25, 0.2, math.pi / 2, 'L0')
    use('props/Fire_01', -HX + 0.48, 1.25, 0.32, 0, 'L0')
    use('props/Firewood_01', -HX + 0.6, -0.6, 0.2, 0.4, 'L0')
    use('props/Carpet_04', -4.6, 1.25, 0.21, math.pi / 2, 'L0', sx=1.3, sy=1.3)
    # Hearth lounge: two stools + a low table
    use('props/Table_01', -4.0, 2.9, 0.2, 0.25, 'L0')
    use('props/Furniture_08', -4.8, 2.4, 0.2, 0.9, 'L0')
    use('props/Furniture_08', -3.2, 3.4, 0.2, -2.0, 'L0')
    use('props/Cup_02', -4.1, 2.8, 0.94, 0.7, 'L0')
    use('props/Candle_02', -3.7, 3.05, 0.94, 0, 'L0')

    # The bar: a long run along the back wall, facing the room
    BAR_Y = -HY + 0.9
    for x in (-2.5, -1.25, 0.0, 1.25, 2.5):
        use('props/BarCounter_01', x, BAR_Y, 0.2, math.pi, 'L0')
    use('props/BarCounter_02', -3.49, BAR_Y, 0.2, math.pi, 'L0')
    use('props/BarCounter_02', 3.49, BAR_Y, 0.2, 0, 'L0')
    # A piece's BACK is on its +y side at rz 0 (measured off the kit), so a
    # cabinet against the -y wall needs rz = pi or it shows the room its back.
    use('props/Furniture_03', -1.5, -HY + 0.45, 0.2, math.pi, 'L0')  # bottle shelves
    use('props/Furniture_03', 1.5, -HY + 0.45, 0.2, math.pi, 'L0')
    use('props/Furniture_05', 3.9, -HY + 0.45, 0.2, math.pi, 'L0')  # sideboard
    use('props/Barrel_03', -3.9, -HY + 0.55, 0.2, 0.3, 'L0')
    for i, (x, b) in enumerate(((-2.3, 'Bottle_01'), (-1.7, 'Bottle_06'), (-0.4, 'Bottle_03'), (0.9, 'Bottle_05'), (2.1, 'Bottle_02'))):
        use('props/' + b, x, BAR_Y - 0.05, 1.25, 0.4 * i, 'L0')
    use('props/Cup_01', 1.6, BAR_Y + 0.08, 1.25, 0.9, 'L0')
    use('props/Cup_03', -1.1, BAR_Y + 0.1, 1.25, 2.0, 'L0')
    use('props/PlateFood_01', 0.3, BAR_Y + 0.05, 1.25, 0.4, 'L0')
    use('props/Candle_01', 2.8, BAR_Y, 1.25, 0, 'L0')
    use('props/Candle_01', -2.9, BAR_Y, 1.25, 0, 'L0')
    # Bar stools along the front of the counter
    for x in (-2.1, -0.7, 0.7, 2.1):
        use('props/Furniture_08', x, BAR_Y + 0.75, 0.2, 0.3 * x, 'L0')

    # The meeting table: one long feast table down the middle with benches
    use('props/Table_02', 0, 0.6, 0.2, 0, 'L0', sx=1.3)
    use('props/Furniture_14', 0, 1.35, 0.2, 0, 'L0')      # backs OUT, seats to the table
    use('props/Furniture_14', 0, -0.15, 0.2, math.pi, 'L0')
    use('props/Carpet_02', 0, 0.6, 0.21, 0, 'L0', sx=2.2, sy=1.6)
    use('props/Candle_05', -1.1, 0.6, 0.87, 0, 'L0')
    use('props/Candle_05', 1.1, 0.6, 0.87, 0, 'L0')
    use('props/PlateFood_02', -0.3, 0.75, 0.87, 0.4, 'L0')
    use('props/Bottle_04', 0.4, 0.45, 0.87, 1.1, 'L0')
    use('props/Cup_02', 0.9, 0.8, 0.87, 2.4, 'L0')
    use('props/Scroll_02', -0.9, 0.4, 0.87, 0.2, 'L0')
    # Side tables with stools
    for tx, ty, r in ((-3.9, -2.2, 0.3), (3.2, 3.3, -0.5), (2.9, -2.1, 0.8)):
        use('props/Table_01', tx, ty, 0.2, r, 'L0')
        use('props/Furniture_08', tx - 0.85, ty + 0.1, 0.2, r + 1.2, 'L0')
        use('props/Furniture_08', tx + 0.85, ty - 0.1, 0.2, r - 1.4, 'L0')
        use('props/Candle_02', tx + 0.1, ty - 0.1, 0.94, r, 'L0')
    use('props/Bottle_03', -3.8, -2.3, 0.94, 0, 'L0')
    use('props/Cup_02', 3.3, 3.2, 0.94, 1.1, 'L0')
    use('props/PlateFood_01', 2.8, -2.0, 0.94, 0.6, 'L0')
    # The notice board by the door, what makes it a meeting point
    use('props/NoticeBoard_01', 2.6, HY - 0.5, 0.2, math.pi, 'L0')
    # Hanging lights from the 2F joists
    for lx, ly in ((-2.6, 0.6), (2.6, 0.6), (0, -2.6)):
        use('props/Light_01', lx, ly, 2.95, 0, 'L0')
    # Clutter: the cellar corner
    use('props/Barrel_01', -5.65, -4.35, 0.2, 0, 'L0')
    use('props/Barrel_02', -5.6, -3.5, 0.2, 0.8, 'L0')
    use('props/Bag_02', -4.9, -4.5, 0.2, 0.3, 'L0')
    use('props/Box_01', -5.7, -2.7, 0.2, 0.4, 'L0')
    use('props/Box_01', -5.65, -2.75, 0.55, 1.2, 'L0')
    use('props/Candle_05', -4.4, -4.6, 0.2, 0.4, 'L0')
    # Walls: a shield over the bar, flags by the door, trophies
    use('props/Shield_02', 0.0, -HY + 0.18, 2.3, 0, 'L0')
    use('props/Flag_03', -3.75, HY - 0.18, 2.75, math.pi, 'L0')
    use('props/Flag_02', 3.75, HY - 0.18, 2.75, math.pi, 'L0')
    use('props/Shield_01', -HX + 0.18, -2.5, 2.1, math.pi / 2, 'L0')
    use('props/Weapon_03', -HX + 0.2, -3.4, 2.2, math.pi / 2, 'L0')

    # Interior stairs along the east wall, rising SOUTH onto the 2F south row.
    # Stairs_03 rises toward its LOCAL -X end (measured: top 3.1 at x -3.43,
    # 0.2 at x +0.25, origin at the low end), so rz=+pi/2 puts the high end
    # at kit -y. The piece origin sits 3.85 north of the ramp centre so the
    # treads span kit y -0.1..4.1 exactly like the walkable deck below.
    STX, STY = HX - 1.1, 1.925
    use('buildings/Stairs_03', STX, STY + 1.925, 0.25, math.pi / 2, 'L0', sx=1.155, sy=1.5)

    # ---------------- second storey (H1) ----------------
    for ix, x in enumerate(XS):
        for iy, y in enumerate(YS):
            if ix == 4 and iy in (2, 3):
                continue  # stairwell
            use('buildings/Floor_03', x, y, 3.1, 0, 'H1')
    # Stairwell guard rails
    for y in (0.75, 2.25, 3.75):
        use('props/Fence_01', 3.8, y, 3.2, math.pi / 2, 'H1')
    use('props/Fence_01', 4.95, 4.55, 3.2, 0, 'H1')
    for x, piece in zip(XS, ('HouseWall_11', 'HouseWall_02', 'HouseWall_12', 'HouseWall_02', 'HouseWall_11')):
        use('buildings/' + piece, x, HY, 3, 0, 'H1')
    for x, piece in zip(XS, ('HouseWall_02', 'HouseWall_12', 'HouseWall_02', 'HouseWall_12', 'HouseWall_02')):
        use('buildings/' + piece, x, -HY, 3, 0, 'H1')
    for y, piece in zip(YS, ('HouseWall_02', 'HouseWall_11', 'HouseWall_02', 'HouseWall_11')):
        use('buildings/' + piece, -HX, y, 3, math.pi / 2, 'H1')
    for y, piece in zip(YS, ('HouseWall_12', 'HouseWall_02', 'HouseWall_02', 'HouseWall_12')):
        use('buildings/' + piece, HX, y, 3, math.pi / 2, 'H1')
    # Rooms: four beds along the end walls, a lounge by the stair
    use('props/Bed_02', -5.2, 3.8, 3.2, math.pi, 'H1')
    use('props/Bed_03', -2.7, 3.8, 3.2, math.pi, 'H1')
    use('props/Bed_01', -5.2, -3.8, 3.2, 0, 'H1')
    use('props/Bed_04', -2.7, -3.8, 3.2, 0, 'H1')
    use('props/Furniture_04', -3.95, 4.35, 3.2, 0, 'H1')   # backs to the wall
    use('props/Furniture_04', -3.95, -4.35, 3.2, math.pi, 'H1')
    use('props/Candle_04', -3.95, 4.4, 3.75, 0, 'H1')
    use('props/Candle_04', -3.95, -4.4, 3.75, 0, 'H1')
    use('props/Chest_01', 0.6, -4.4, 3.2, 0, 'H1')
    use('props/Chest_01', 0.6, 4.4, 3.2, math.pi, 'H1')
    use('props/Carpet_05', -1.4, 0.0, 3.21, 0, 'H1', sx=1.4, sy=1.4)
    use('props/Carpet_01', -4.0, 0.0, 3.21, math.pi / 2, 'H1')
    use('props/Furniture_07', 1.6, 4.4, 3.2, 0, 'H1')
    use('props/Candle_02', 1.55, 4.45, 3.65, 0.4, 'H1')
    use('props/Table_01', 1.4, 0.6, 3.2, 0.2, 'H1')
    use('props/Furniture_08', 0.6, 0.5, 3.2, 1.3, 'H1')
    use('props/Furniture_08', 2.2, 0.8, 3.2, -1.6, 'H1')
    use('props/Book_03', 1.3, 0.6, 3.94, 0.3, 'H1')
    use('props/Candle_02', 1.7, 0.45, 3.94, 0, 'H1')
    use('props/Bag_02', 2.3, -4.3, 3.2, 0.8, 'H1')
    use('props/Flag_01', -HX + 0.2, 0.0, 5.6, math.pi / 2, 'H1')

    # ---------------- roof (H2) ----------------
    RSX, RSY, RSZ = 1.227, 1.29, 1.25
    Z_EAVE = 6.0
    z_roof = Z_EAVE - 3.587 * RSZ
    Z_RIDGE = z_roof + 8.354 * RSZ
    roof = use('buildings/HouseRoof_05', 0, 0, z_roof, 0, 'H2', sx=RSX, sy=RSY, sz=RSZ)
    retint_roof([roof])
    HALF_EAVE = 4.291 * RSY - 0.12
    gable_solid(HX + 0.08, Z_EAVE, Z_RIDGE, HALF_EAVE, axis='x', grp='H2')
    gable_solid(-(HX + 0.08), Z_EAVE, Z_RIDGE, HALF_EAVE, axis='x', grp='H2')
    # Chimney over the hearth; roof surface at y=1.25 sits ~10.6, base tucked under
    use('buildings/Chimney_01', -5.3, 1.25, 9.8, 0, 'H2')

    # Entry steps
    steps(0.0, HY + 0.18, 0, 3.0, 2, 0.2)

    # ---------------- exterior dressing (L0) ----------------
    use('props/SignBoard_05', 3.9, HY + 0.17, 2.25, -math.pi / 2, 'L0')  # over the bench
    use('props/Lantern_01', -2.6, HY + 0.55, 0, math.pi, 'L0')
    use('props/Lantern_01', 2.6, HY + 0.55, 0, math.pi, 'L0')
    use('props/Furniture_14', 3.9, HY + 0.55, 0, math.pi, 'L0')  # back to the wall
    use('props/Barrel_01', -4.3, HY + 0.8, 0, 0, 'L0')
    use('props/Barrel_02', -5.1, HY + 0.7, 0, 0.7, 'L0')
    use('nature/FlowerPot_02', -3.2, HY + 0.65, 0, 0.4, 'L0')
    use('nature/FlowerPot_05', 5.6, HY + 0.65, 0, 1.2, 'L0')
    use('props/NoticeBoard_01', -HX - 0.75, 2.0, 0, math.pi / 2, 'L0')
    # Ivy_02 is an inverted V (8.76 long, apex 5.03 up, leg ends 0.34 below its
    # origin). Hung flat on the ground-floor wall it floated mid-facade; scaled
    # to the east gable it drapes along the roof line instead: legs reach the
    # eave corners (+-HALF_EAVE at Z_EAVE), the apex sits under the ridge, and
    # it lives in the roof group so it hides with the roof from inside.
    IVY_SX = (2 * HALF_EAVE) / 8.76
    IVY_SZ = (Z_RIDGE - Z_EAVE) / (5.03 + 0.34)
    use('nature/Ivy_02', HX + 0.45, 0.0, Z_EAVE + 0.34 * IVY_SZ, math.pi / 2, 'H2', sx=IVY_SX, sy=1.0, sz=IVY_SZ)

    # ---------------- collision ----------------
    T = 0.2
    col_wall(-HX, HY, -0.55, HY, 0, 6, T)
    col_wall(0.55, HY, HX, HY, 0, 6, T)
    col(0, HY, 2.6, 0.55, T, 0.45)  # lintel
    col_wall(-HX, -HY, HX, -HY, 0, 6, T)
    col_wall(-HX, -HY, -HX, HY, 0, 6, T)
    col_wall(HX, -HY, HX, HY, 0, 6, T)
    col(-HX + 0.45, 1.25, 1.5, 0.35, 0.85, 1.5)  # hearth
    col(0, BAR_Y, 0.75, 3.85, 0.35, 0.55)  # bar run
    col(-1.5, -HY + 0.45, 1.15, 0.65, 0.3, 1.15)
    col(1.5, -HY + 0.45, 1.15, 0.65, 0.3, 1.15)
    col(3.9, -HY + 0.45, 0.5, 0.7, 0.27, 0.5)
    col(0, 0.6, 0.6, 1.75, 0.45, 0.45)  # feast table
    col(0, 1.35, 0.45, 1.5, 0.25, 0.3)
    col(0, -0.15, 0.45, 1.5, 0.25, 0.3)
    for tx, ty in ((-3.9, -2.2), (3.2, 3.3), (2.9, -2.1), (-4.0, 2.9)):
        col(tx, ty, 0.6, 0.6, 0.6, 0.45)
    col(2.6, HY - 0.5, 1.1, 0.9, 0.25, 0.95)  # notice board
    col(-5.5, -3.9, 0.85, 0.7, 0.8, 0.5)  # cellar corner
    # Stair deck in two pieces that follow the treads (piece sits at z 0.25 so
    # the feet split the difference: ~0.1 kit into the treads on the flight,
    # ~0.05 above the landing). The flight climbs from a stride above the floor
    # deck to the 3.2 summit by kit y 0.4; the landing is a FLAT deck at 3.2
    # from there to -0.275. It must already be at the summit before the body's
    # radius (0.27 kit) reaches the 2F floor box edge at y=0: the merge script
    # tops those boxes 0.02 under 3.2, and a grounded mover can only step DOWN
    # onto a box. rz=-pi/2 puts z1 (the high end) at kit -y.
    ramp(STX, 2.2625, 1.8625, 0.95, -math.pi / 2, 0.28, 3.2)
    ramp(STX, 0.1125, 0.3875, 0.95, -math.pi / 2, 3.2, 3.2)
    # 2F floor as thin STANDABLE boxes (stairwell open)
    col(-1.25, 0.0, 3.14, 5.0, 5.0, 0.08)
    col(5.0, -2.5, 3.14, 1.25, 2.5, 0.08)
    col(3.8, 2.5, 3.75, 0.12, 2.5, 0.55)  # rails
    col(4.95, 4.55, 3.75, 1.3, 0.12, 0.55)
    for bx, by in ((-5.2, 3.8), (-2.7, 3.8), (-5.2, -3.8), (-2.7, -3.8)):
        col(bx, by, 3.6, 0.65, 1.05, 0.4)
    col(0.6, -4.4, 3.58, 0.5, 0.3, 0.38)
    col(0.6, 4.4, 3.58, 0.5, 0.3, 0.38)
    col(1.6, 4.4, 3.42, 0.78, 0.22, 0.22)
    col(1.4, 0.6, 3.6, 0.6, 0.6, 0.4)

    interior(-HX + 0.2, HX - 0.2, -HY + 0.2, HY - 0.2, 0.0, 3.05)
    interior(-HX + 0.2, HX - 0.2, -HY + 0.2, HY - 0.2, 3.05, Z_RIDGE)

    # The shipped tavern carried the template decimation pass (bl_optimise3):
    # without it this export doubles the vertex count.
    exec(open(SCRATCH + '/bl_optimise3.py').read())
    # Safe lightening for an EXPLORABLE building: no hidden-face cull (the
    # interior is the point), but flat step slabs, planar dissolve within each
    # material away from the wall modules, and collapse on the prop families.
    flatten_tiles()
    dissolve_planar()
    decimate_slabs()
    plaster_exterior()
    finalize('tidehold_tavern', SCRATCH + '/out', S)

    render_shot(SCRATCH + '/shots/tavern2_ext.png', (18, 30, 13), (0, 0, 6), w=1500, h=1000)
    render_shot(SCRATCH + '/shots/tavern2_ext2.png', (-24, -18, 12), (0, 0, 6), w=1500, h=1000)
    for o in list(_GROUPS.get('H1').children) + list(_GROUPS.get('H2').children):
        o.hide_set(True)
    render_shot(SCRATCH + '/shots/tavern2_int1.png', (-2.0, 7.0, 4.0), (1.5, -7.5, 1.6), w=1500, h=1000, fov=70)
    render_shot(SCRATCH + '/shots/tavern2_int2.png', (7.5, 5.0, 3.6), (-9.0, -2.0, 1.6), w=1500, h=1000, fov=70)
    for o in list(_GROUPS.get('H1').children):
        o.hide_set(False)
    render_shot(SCRATCH + '/shots/tavern2_up.png', (-8.0, -6.0, 9.0), (1.0, 3.0, 5.6), w=1500, h=1000, fov=66)
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(False)
    print('TAVERN2 DONE')
except Exception:
    print(traceback.format_exc())
