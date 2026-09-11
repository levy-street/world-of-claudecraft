# The Emberworks, smithy, CLEAN REBUILD. 7.5 x 7.5 hut, ridge running N-S so
# the gables face the street, lean-to forge porch on the east eave with two
# posts. Front faces +Y. S=1.8.
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/b3a5eb48-37dc-4429-b53c-25163d3a9b01/scratchpad/bl'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    exec(open(SCRATCH + '/bl_lite.py').read())
    FLOOR_DEFAULT = 'tiles'
    exec(open(SCRATCH + '/bl_forge.py').read())
    reset_build()
    M = 2.5
    HX = HY = 3.75
    S = 1.8
    # Walking surfaces: Floor_06 tiles sit 0.111 above their origin (placed at
    # z 0.1), the porch Tile_02 slabs 0.120 above theirs (placed at 0). Every
    # prop stands ON these, not on the kit's nominal 0.14 / 0.17.
    FLOOR_Z = 0.1 + 0.111
    PORCH_Z = 0.120

    # ---------------- hut shell (L0) ----------------
    for ix in range(3):
        for iy in range(3):
            use('buildings/Floor_06', -HX + M / 2 + ix * M, -HY + M / 2 + iy * M, 0.1, 0, 'L0')
    # Front (+Y): shop window / door / plain, clean 3-module run
    use('buildings/HouseWall_13', -2.5, HY, 0, 0, 'L0')
    use('buildings/HouseWall_10', 0, HY, 0, 0, 'L0')  # door: opening is CENTRED, x -0.5..0.5 (measured 2026-09-07)
    use('buildings/HouseWall_06', 2.5, HY, 0, 0, 'L0')
    use('buildings/HouseDoor_02', -0.5, HY - 0.1, FLOOR_Z, -2.5, 'L0')   # hinge on the west jamb of the real opening
    # Back (-Y)
    use('buildings/HouseWall_06', -2.5, -HY, 0, 0, 'L0')
    use('buildings/HouseWall_02', 0, -HY, 0, 0, 'L0')
    use('buildings/HouseWall_12', 2.5, -HY, 0, 0, 'L0')
    # West side: 3 clean modules
    use('buildings/HouseWall_11', -HX, -2.5, 0, math.pi / 2, 'L0')
    use('buildings/HouseWall_06', -HX, 0, 0, math.pi / 2, 'L0')
    use('buildings/HouseWall_02', -HX, 2.5, 0, math.pi / 2, 'L0')
    # East side: porch door centered, windows flanking
    use('buildings/HouseWall_02', HX, -2.5, 0, math.pi / 2, 'L0')
    use('buildings/HouseWall_09', HX, 0, 0, math.pi / 2, 'L0')  # centered opening
    use('buildings/HouseWall_11', HX, 2.5, 0, math.pi / 2, 'L0')
    for cx, cy in ((-HX, -HY), (-HX, HY), (HX, -HY), (HX, HY)):
        use('buildings/Corner_03', cx, cy, 0, 0, 'L0')
    # Stone foundation course on every outside wall, skipping the two door bays
    # (front door module at x 0, porch door module at y 0).
    for x_ in (-2.5, 2.5):
        use('buildings/HouseBase_01', x_, HY + 0.16, 0, 0, 'L0')
    for x_ in (-2.5, 0.0, 2.5):
        use('buildings/HouseBase_01', x_, -HY - 0.16, 0, math.pi, 'L0')
    for y_ in (-2.5, 0.0, 2.5):
        use('buildings/HouseBase_01', -HX - 0.16, y_, 0, math.pi / 2, 'L0')
    for y_ in (-2.5, 2.5):
        use('buildings/HouseBase_01', HX + 0.16, y_, 0, -math.pi / 2, 'L0')

    # ---------------- hut interior ----------------
    use('props/Furniture_09', -2.85, -2.85, FLOOR_Z, 0.0, 'L0')  # workbench
    use('props/Blacksmith_04', -2.5, 2.35, FLOOR_Z, -0.6, 'L0')  # grindstone
    use('props/Furniture_07', 0.5, -3.3, FLOOR_Z, 0, 'L0')
    use('props/Weapon_02', 0.3, -3.4, 0.69 + 0.071, 0.3, 'L0')
    use('props/Helmet_01', 0.85, -3.28, 0.65 + 0.071, 0.8, 'L0')
    use('props/Shield_01', -3.6, -1.2, 1.9, math.pi / 2, 'L0')
    use('props/Shield_02', -1.0, -3.6, 2.0, 0, 'L0')
    use('props/Blacksmith_05', -1.9, -3.62, 2.2, 0, 'L0')
    use('props/Blacksmith_06', -2.3, -3.62, 2.25, 0, 'L0')
    use('props/Blacksmith_07', -2.72, -3.55, 1.9, 0, 'L0')
    use('props/Firewood_01', -3.15, 0.9, FLOOR_Z, 1.2, 'L0')
    col(-3.15, 0.9, 0.55, 0.52, 0.36, 0.32)
    use('props/Carpet_06', 0.1, 0.3, FLOOR_Z + 0.012, 0.25, 'L0')
    use('props/Candle_05', 2.75, -2.85, FLOOR_Z, 0, 'L0')
    col(2.75, -2.85, 0.85, 0.22, 0.22, 0.62)
    use('props/Lantern_02', 0.9, HY - 0.25, 2.35, math.pi, 'L0')
    use('props/Barrel_01', 2.9, 2.9, FLOOR_Z, 0.5, 'L0')

    # Sign + entry steps
    use('props/SignBoard_06', 1.6, HY + 0.19, 2.15, -math.pi / 2, 'L0')
    steps(-0.55, HY + 0.18, 0, 1.9, 2, 0.2)

    # ---------------- forge porch (east) ----------------
    # A timber-framed lean-to off the east wall: two posts under the outer
    # eave corners, a tie beam between them and an eave beam back to the wall
    # on each side, the roof piece scaled to span exactly post to post. The
    # forge is a custom masonry hearth (bl_forge.py) built against the wall
    # with its stack rising through the porch roof, the anvil at working
    # distance in front of it, the  tools racked on the wall, stores at the south end. The east
    # side is the open entry; only the south side carries a rail.
    PORCH_Y = 3.75
    POST_X = 7.1
    for iy in range(3):
        use('environment/Tile_02', 5.5, -2.5 + iy * 2.5, 0.0, 0, 'L0', sx=1.3)
    for py in (-PORCH_Y + 0.25, PORCH_Y - 0.25):
        use('buildings/Corner_01', POST_X, py, 0, 0, 'L0', sz=2.85 / 3.70)
        wood_box((HX + POST_X) / 2, py, 2.55, 2.75, (POST_X - HX) / 2 + 0.05, 0.12)  # eave beam
    wood_box(POST_X, 0.0, 2.55, 2.75, 0.12, PORCH_Y - 0.25 + 0.12)                 # tie beam
    # the forge: hood open toward +x (the smith stands on the porch)
    FORGE = (4.85, 1.75)
    hearth = forge(FORGE[0], FORGE[1], facing=-math.pi / 2)
    brick_box(HX + 0.2, FORGE[1], 0.0, 1.85, 0.22, 0.85)                            # closes the gap to the wall
    use('props/Blacksmith_01', 6.45, 1.6, PORCH_Z, 0.0, 'L0')                           # anvil on its stump, a stride from the hearth
    # tool rack on the hut wall, south of the forge
    use('props/Blacksmith_05', HX + 0.12, -1.1, 2.1, -math.pi / 2, 'L0')
    use('props/Blacksmith_06', HX + 0.12, -1.5, 2.15, -math.pi / 2, 'L0')
    use('props/Blacksmith_07', HX + 0.12, -1.9, 1.85, -math.pi / 2, 'L0')
    # stores at the south end
    use('props/Barrel_02', 6.6, -2.9, PORCH_Z, 0.9, 'L0')
    use('props/Box_01', 6.35, -2.15, PORCH_Z, 0.3, 'L0')
    use('props/Firewood_01', 4.15, -3.1, PORCH_Z, 0.0, 'L0')
    # south rail between the wall and the south post
    use('props/Fence_01', 4.55, -PORCH_Y + 0.15, PORCH_Z, 0, 'L0')
    use('props/Fence_01', 6.05, -PORCH_Y + 0.15, PORCH_Z, 0, 'L0')

    # ---------------- roofs (H2) ----------------
    # Main roof ridge along Y: gables face the street; east eave feeds the porch
    roof = use('buildings/HouseRoof_04', 0, 0, -0.54, math.pi / 2, 'H2')
    # Porch roof: HouseRoof_07 (raw: slope span x +-1.82, ridge along y from
    # -1.77 to 0.85, 2.36 high). Rotated so the ridge runs out from the wall,
    # slope span scaled to the posts (+-3.9), ridge length to run from under
    # the main eave to just past the tie beam (x 3.2..7.5), and squashed so its
    # eave underside meets the beams at 2.72 and the ridge tucks under the
    # main roof slope where they meet.
    lean = use('buildings/HouseRoof_07', 6.1, 0, 2.5, -math.pi / 2, 'H2', sx=2.14, sy=1.64, sz=0.75)
    gable_solid(3.5, 3.05, 7.6, 4.05, axis='y', grp='H2')
    gable_solid(-3.5, 3.05, 7.6, 4.05, axis='y', grp='H2')

    # ---------------- collision ----------------
    T = 0.2
    # Front wall, door gap x -0.5..0.5 (HouseWall_10's opening is centred; the
    # old -1.05..-0.05 gap sat half a module off it and walled the doorway,     # Troy: "they have to clip through the wall")
    col_wall(-HX, HY, -0.5, HY, 0, 5.5, T)
    col_wall(0.5, HY, HX, HY, 0, 5.5, T)
    col_wall(-HX, -HY, HX, -HY, 0, 5.5, T)
    col_wall(-HX, -HY, -HX, HY, 0, 5.5, T)
    # East wall, centered porch-door gap y -0.55..0.55
    col_wall(HX, -HY, HX, -0.55, 0, 5.5, T)
    col_wall(HX, 0.55, HX, HY, 0, 5.5, T)
    col(0.0, HY, 2.6, 0.55, 0.2, 0.45)  # front door lintel
    col(HX, 0, 2.6, 0.2, 0.6, 0.45)  # porch door lintel
    # Porch posts, beams + rail
    col(POST_X, -PORCH_Y + 0.25, 1.45, 0.3, 0.3, 1.45)
    col(POST_X, PORCH_Y - 0.25, 1.45, 0.3, 0.3, 1.45)
    col(5.3, -PORCH_Y + 0.15, 0.75, 1.55, 0.1, 0.6)
    # Interior gear
    col(-2.85, -2.85, 0.6, 0.85, 0.45, 0.6)
    col(-2.5, 2.35, 0.75, 0.8, 0.5, 0.75)
    col(0.5, -3.3, 0.4, 0.8, 0.25, 0.4)
    col(2.9, 2.9, 0.55, 0.42, 0.42, 0.55)
    # Porch gear: forge (base + back), anvil, stores
    col(FORGE[0], FORGE[1], 0.95, 0.72, 0.87, 0.95)
    col(HX + 0.2, FORGE[1], 0.95, 0.22, 0.87, 0.95)
    col(6.45, 1.6, 0.5, 0.5, 0.5, 0.5)
    col(6.6, -2.9, 0.55, 0.45, 0.45, 0.55)
    col(6.35, -2.15, 0.35, 0.35, 0.35, 0.35)
    col(4.15, -3.1, 0.3, 0.5, 0.35, 0.3)

    interior(-HX + 0.2, HX - 0.2, -HY + 0.2, HY - 0.2, 0.0, 3.05)
    interior(HX, 7.1, -HY, HY, 0.0, 3.05)

    flatten_tiles()
    stone_floors()
    dissolve_planar()
    decimate_slabs()
    plaster_exterior()
    finalize('tidehold_smithy', SCRATCH + '/out', S)
    render_shot(SCRATCH + '/smithy_ext.png', (24, 22, 12), (1.5, 0, 4.5), w=1500, h=1000)
    render_shot(SCRATCH + '/smithy_ext2.png', (22, -20, 11), (1.5, 0, 4.5), w=1500, h=1000)
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(True)
    render_shot(SCRATCH + '/smithy_int.png', (-3.5, 7.5, 5.5), (4.5, -4.0, 0.8), w=1500, h=1000, fov=66)
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(False)
except Exception:
    print(traceback.format_exc())
