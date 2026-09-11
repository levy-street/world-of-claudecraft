# The Gilded Gull, two-storey tavern. Front faces +Y (exports to -Z).
# Footprint 10 x 7.5 kit units, ground walls 3 tall, 2F walls 3 tall, gable roof.
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/cbf8046f-7d43-48f1-b70b-3b602edd9a6d/scratchpad'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    reset_build()
    M = 2.5
    HX, HY = 5.0, 3.75  # half footprint
    S = 1.85

    # ---------------- ground floor (L0) ----------------
    # Floor: 4x3 wood plank tiles, top at z=0.2
    for ix in range(4):
        for iy in range(3):
            use('buildings/Floor_04', -HX + M / 2 + ix * M, -HY + M / 2 + iy * M, 0.1, 0, 'L0')
    # Front wall (y=+HY): door module at x=+1.25, window, plain, big window
    use('buildings/HouseWall_13', -3.75, HY, 0, 0, 'L0')
    use('buildings/HouseWall_02', -1.25, HY, 0, 0, 'L0')
    use('buildings/HouseWall_08', 1.25, HY, 0, 0, 'L0')  # door opening
    use('buildings/HouseWall_11', 3.75, HY, 0, 0, 'L0')
    # Door ajar, hinge at opening's west jamb
    use('buildings/HouseDoor_01', 0.72, HY - 0.1, 0.0, -2.55, 'L0')
    # Back wall (y=-HY)
    use('buildings/HouseWall_06', -3.75, -HY, 0, 0, 'L0')
    use('buildings/HouseWall_06', -1.25, -HY, 0, 0, 'L0')
    use('buildings/HouseWall_02', 1.25, -HY, 0, 0, 'L0')
    use('buildings/HouseWall_12', 3.75, -HY, 0, 0, 'L0')
    # Side walls: clean 3-module runs (no scaled fillers). East side is the
    # stair side, deliberately windowless; west gets the windows.
    use('buildings/HouseWall_11', -HX, -2.5, 0, math.pi / 2, 'L0')
    use('buildings/HouseWall_02', -HX, 0, 0, math.pi / 2, 'L0')
    use('buildings/HouseWall_02', -HX, 2.5, 0, math.pi / 2, 'L0')  # fireplace bay
    use('buildings/HouseWall_02', HX, -2.5, 0, math.pi / 2, 'L0')
    use('buildings/HouseWall_02', HX, 0, 0, math.pi / 2, 'L0')
    use('buildings/HouseWall_02', HX, 2.5, 0, math.pi / 2, 'L0')
    # Corners, full two-storey stone
    for cx, cy in ((-HX, -HY), (-HX, HY), (HX, -HY), (HX, HY)):
        use('buildings/Corner_04', cx, cy, 0, 0, 'L0')
    # Base skirt outside front
    use('buildings/HouseBase_01', -3.75, HY + 0.16, 0, 0, 'L0')
    use('buildings/HouseBase_01', -1.25, HY + 0.16, 0, 0, 'L0')
    use('buildings/HouseBase_01', 3.75, HY + 0.16, 0, 0, 'L0')

    # Fireplace on west wall, inside
    use('buildings/Fireplace_01', -4.55, 1.25, 0.2, math.pi / 2, 'L0')
    use('props/Firewood_01', -4.4, -0.6, 0.2, 0.4, 'L0')
    # Bar counter along back-right, facing the room
    use('props/BarCounter_02', 2.2, -2.9, 0.2, math.pi, 'L0')
    use('props/BarCounter_03', 4.0, -2.9, 0.2, math.pi, 'L0')
    use('props/Furniture_03', 4.3, -3.45, 0.2, 0, 'L0')  # bookcase behind bar
    use('props/Furniture_05', 2.0, -3.5, 0.2, 0, 'L0')  # sideboard
    # Tables + stools
    use('props/Table_01', -2.0, -1.6, 0.2, 0.3, 'L0')
    use('props/Table_01', 1.6, 0.9, 0.2, -0.4, 'L0')
    use('props/Table_02', -2.4, 1.8, 0.2, math.pi / 2, 'L0')
    for tx, ty, r in ((-2.9, -1.0, 0.5), (-1.2, -2.1, 2.2), (2.4, 0.4, 1.2), (0.9, 1.5, -0.7)):
        use('props/Furniture_08', tx, ty, 0.2, r, 'L0')
    # Table dressing
    use('props/Bottle_03', -2.1, -1.5, 0.94, 0, 'L0')
    use('props/Cup_02', -1.8, -1.75, 0.94, 1.1, 'L0')
    use('props/PlateFood_01', 1.5, 1.0, 0.94, 0.4, 'L0')
    use('props/Candle_02', -2.35, 1.8, 0.94, 0, 'L0')
    use('props/Candle_01', 2.5, -2.75, 1.28, 0, 'L0')
    # Carpets
    use('props/Carpet_02', -0.3, -0.2, 0.21, 0.1, 'L0')
    use('props/Carpet_04', -3.6, 1.2, 0.21, math.pi / 2, 'L0')
    # Clutter
    use('props/Barrel_01', -4.35, -2.9, 0.2, 0, 'L0')
    use('props/Barrel_02', -4.3, -2.05, 0.2, 0.8, 'L0')
    use('props/Bag_02', -3.65, -2.6, 0.2, 0.3, 'L0')
    use('props/Candle_05', -3.4, -3.3, 0.2, 0.4, 'L0')
    use('props/Furniture_02', 0.3, -3.5, 0.2, 0, 'L0')
    use('props/Fire_01', -4.52, 1.25, 0.32, 0, 'L0')
    use('props/Shield_02', 0.0, -HY + 0.18, 2.1, 0, 'L0')

    # Wainscot strips along the interior wall bases
    for wx in (-3.75, -1.25, 1.25):
        use('buildings/HouseBase_01', wx, -HY + 0.18, 0, math.pi, 'L0')
    use('buildings/HouseBase_01', -HX + 0.18, 0.0, 0, -math.pi / 2, 'L0')
    use('buildings/HouseBase_01', -HX + 0.18, -2.4, 0, -math.pi / 2, 'L0')
    # More tavern life: bottle row on the bar, mugs, a stool, stacked crates
    use('props/Bottle_01', 1.7, -2.8, 1.28, 0.4, 'L0')
    use('props/Bottle_06', 2.0, -2.95, 1.28, 1.7, 'L0')
    use('props/Cup_01', 3.6, -2.8, 1.28, 0.9, 'L0')
    use('props/PlateFood_02', -2.55, 1.55, 0.94, 2.2, 'L0')
    use('props/Furniture_08', 0.4, -1.3, 0.2, 1.9, 'L0')
    use('props/Box_01', 4.35, -2.0, 0.2, 0.4, 'L0')
    use('props/Box_01', 4.3, -2.05, 0.55, 1.2, 'L0')
    use('props/Flag_03', -1.3, HY - 0.18, 2.75, math.pi, 'L0')
    use('props/Shield_01', -4.82, -0.35, 2.1, math.pi / 2, 'L0')

    # Interior stairs along east wall, rising north (+Y), top at 2F
    use('buildings/Stairs_03', 3.9, 0.925, 0.2, -math.pi / 2, 'L0', sx=1.155, sy=1.5)

    # ---------------- second storey (H1) ----------------
    # 2F floor: leave stairwell opening at the east strip y in [-0.5..2.2]
    for ix in range(4):
        for iy in range(3):
            x = -HX + M / 2 + ix * M
            y = -HY + M / 2 + iy * M
            if ix == 3 and iy in (1, 2):
                continue  # stairwell
            use('buildings/Floor_03', x, y, 3.1, 0, 'H1')
    # Stairwell guard rail on 2F
    use('props/Fence_01', 2.55, -0.35, 3.2, math.pi / 2, 'H1')
    use('props/Fence_01', 2.55, 1.15, 3.2, math.pi / 2, 'H1')
    use('props/Fence_01', 2.55, 2.65, 3.2, math.pi / 2, 'H1')
    # 2F walls
    use('buildings/HouseWall_11', -3.75, HY, 3, 0, 'H1')
    use('buildings/HouseWall_02', -1.25, HY, 3, 0, 'H1')
    use('buildings/HouseWall_12', 1.25, HY, 3, 0, 'H1')
    use('buildings/HouseWall_02', 3.75, HY, 3, 0, 'H1')
    use('buildings/HouseWall_02', -3.75, -HY, 3, 0, 'H1')
    use('buildings/HouseWall_12', -1.25, -HY, 3, 0, 'H1')
    use('buildings/HouseWall_02', 1.25, -HY, 3, 0, 'H1')
    use('buildings/HouseWall_11', 3.75, -HY, 3, 0, 'H1')
    use('buildings/HouseWall_02', -HX, -2.5, 3, math.pi / 2, 'H1')
    use('buildings/HouseWall_11', -HX, 0, 3, math.pi / 2, 'H1')
    use('buildings/HouseWall_02', -HX, 2.5, 3, math.pi / 2, 'H1')
    use('buildings/HouseWall_12', HX, -2.5, 3, math.pi / 2, 'H1')
    use('buildings/HouseWall_02', HX, 0, 3, math.pi / 2, 'H1')
    use('buildings/HouseWall_02', HX, 2.5, 3, math.pi / 2, 'H1')
    # 2F furnishing: beds, nightstand, chest, carpet
    use('props/Bed_02', -4.0, 2.6, 3.2, math.pi, 'H1')
    use('props/Bed_03', -1.6, 2.6, 3.2, math.pi, 'H1')
    use('props/Bed_01', -4.0, -2.5, 3.2, 0, 'H1')
    use('props/Furniture_04', -2.8, 2.9, 3.2, math.pi, 'H1')
    use('props/Furniture_04', -2.8, -2.9, 3.2, 0, 'H1')
    use('props/Chest_01', 0.6, -3.1, 3.2, 0, 'H1')
    use('props/Carpet_05', -1.4, 0.2, 3.21, 0, 'H1')
    use('props/Carpet_01', -2.9, 1.3, 3.21, math.pi / 2, 'H1')
    use('props/Candle_04', -2.8, 3.0, 3.75, 0, 'H1')
    use('props/Furniture_07', 0.8, 2.9, 3.2, math.pi, 'H1')
    use('props/Candle_02', 0.75, 3.0, 3.65, 0.4, 'H1')
    use('props/Bag_02', 1.8, -3.0, 3.2, 0.8, 'H1')

    # ---------------- roof (H2) ----------------
    roof = use('buildings/HouseRoof_05', 0, 0, 2.413, 0, 'H2')
    chim = use('buildings/Chimney_01', -4.3, 1.25, 8.5, 0, 'H2')
    retint_roof([roof])
    # Closed gable ends (the big roofs ship with open trusses)
    gable_solid(5.08, 6.0, 10.7, 4.18, axis='x', grp='H2')
    gable_solid(-5.08, 6.0, 10.7, 4.18, axis='x', grp='H2')

    # Entry steps: custom cobble stack at the door
    steps(1.25, HY + 0.18, 0, 2.1, 2, 0.2)

    # ---------------- exterior dressing (L0) ----------------
    use('props/SignBoard_05', 2.75, HY + 0.17, 2.15, -math.pi / 2, 'L0')
    use('props/Barrel_01', -1.9, HY + 0.8, 0, 0, 'L0')
    use('nature/FlowerPot_02', -2.6, HY + 0.7, 0, 0.4, 'L0')
    use('nature/FlowerPot_05', 4.4, HY + 0.65, 0, 1.2, 'L0')

    # ---------------- collision ----------------
    T = 0.2
    # Front wall with door gap x in [0.7, 1.8]
    col_wall(-HX, HY, 0.7, HY, 0, 6, T)
    col_wall(1.8, HY, HX, HY, 0, 6, T)
    col(1.25, HY, 2.6, 0.55, T, 0.45)  # lintel over door
    col_wall(-HX, -HY, HX, -HY, 0, 6, T)
    col_wall(-HX, -HY, -HX, HY, 0, 6, T)
    col_wall(HX, -HY, HX, HY, 0, 6, T)
    # Fireplace + bar + big furniture
    col(-4.55, 1.25, 1.5, 0.35, 0.85, 1.5)
    col(2.2, -2.9, 0.75, 0.95, 0.35, 0.55)
    col(4.0, -2.9, 0.75, 0.85, 0.35, 0.55)
    col(-2.0, -1.6, 0.6, 0.6, 0.6, 0.45)
    col(1.6, 0.9, 0.6, 0.6, 0.6, 0.45)
    col(-2.4, 1.8, 0.6, 0.5, 0.7, 0.45)
    col(-4.3, -2.5, 0.5, 0.5, 0.85, 0.5)
    col(4.3, -3.45, 1.15, 0.65, 0.3, 1.15)  # bar-back bookcase
    col(2.0, -3.5, 0.5, 0.7, 0.27, 0.5)  # sideboard
    col(0.6, -3.1, 3.58, 0.5, 0.3, 0.38)  # 2F chest
    col(0.8, 2.9, 3.42, 0.78, 0.22, 0.22)  # 2F dresser
    # Stairs: blocking under-side none; walkable deck rising +Y
    ramp(3.9, 0.925, 2.2, 0.95, -math.pi / 2, 0.2, 3.2)
    # 2F floor as thin STANDABLE boxes (a walkable deck would replace the
    # ground floor under it - heightfield rule; banded OBBs stack instead)
    col(-1.25, 0.0, 3.14, 3.75, 3.75, 0.08)
    col(3.75, -2.5, 3.14, 1.25, 1.25, 0.08)
    # Stairwell guard rails on 2F
    col(2.55, 1.15, 3.75, 0.12, 2.35, 0.55)
    # Beds and chest upstairs
    col(-4.0, 2.6, 3.6, 0.65, 1.05, 0.4)
    col(-1.6, 2.6, 3.6, 0.65, 1.05, 0.4)
    col(-4.0, -2.5, 3.6, 0.65, 1.05, 0.4)

    # ---------------- interiors ----------------
    interior(-HX + 0.2, HX - 0.2, -HY + 0.2, HY - 0.2, 0.0, 3.05)  # ground
    interior(-HX + 0.2, HX - 0.2, -HY + 0.2, HY - 0.2, 3.05, 6.0)  # storey 2

    finalize('tidehold_tavern', SCRATCH + '/out', S)

    # Shots (post-finalize: everything scaled by S)
    render_shot(SCRATCH + '/tavern_ext.png', (14, 26, 12), (0, 0, 5), w=1500, h=1000)
    render_shot(SCRATCH + '/tavern_ext2.png', (-20, -16, 11), (0, 0, 5), w=1500, h=1000)
    # Interior: hide roof + 2F the way the game will
    for o in list(_GROUPS.get('H1').children) + list(_GROUPS.get('H2').children):
        o.hide_set(True)
    render_shot(SCRATCH + '/tavern_int1.png', (-1.0, 4.2, 3.4), (2.5, -4.2, 1.6), w=1500, h=1000, fov=68)
    render_shot(SCRATCH + '/tavern_int2.png', (4.5, 3.5, 3.2), (-6.5, -1.0, 1.6), w=1500, h=1000, fov=68)
    for o in list(_GROUPS.get('H1').children):
        o.hide_set(False)
    render_shot(SCRATCH + '/tavern_int_up.png', (-6.2, -4.4, 7.6), (0, 3.0, 5.2), w=1500, h=1000, fov=66)
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(False)
except Exception:
    print(traceback.format_exc())
