# Tavern Type B, "The Anchor & Antler", Tidehold's second inn.
#
# Troy, 2026-09-09: a tavern "similar to the current one but more complex and
# interesting layout", from a Warcraft-style reference: a long slate-roofed hall
# with a CROSS-GABLED front wing, a slender belfry tower rising over the
# crossing, a dormer in the main slope, a little porch roof over the door on
# posts, cloth awnings at both ends and a heavy chimney. "Really big cozy
# interior and all the layout makes sense."
#
# The plan that gives it that: one 15 x 10 hall, two storeys, but the middle
# THIRD of the upper floor is left out, so the common room is open to the
# ridge and a gallery runs round the void on three sides, looking down on the
# hearth. Ground floor reads left to right: hearth lounge (west), the long bar
# across the back, feast tables in the middle under the void, snug alcoves in
# the cross wing either side of the door. Up the stair: gallery, four bedrooms
# in the two ends, a reading nook over the porch.
#
# Front faces +Y (exports to -Z). Kit units, S = 1.85, walls 3 tall per storey.
# Headless: [PREVIEW=1] Blender -b --python <this>
import os
import traceback

LOG = []
try:
    SCRATCH = os.environ.get(
        'TIDEHOLD_SCRATCH',
        '/private/tmp/claude-501/-Users-troy-Documents-Codex/59e45b26-315c-4e8d-9478-c0cc7c32f012/scratchpad/bl',
    )
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    exec(open(SCRATCH + '/bl_lite.py').read())
    FLOOR_DEFAULT = 'planks'
    PREVIEW = bool(globals().get('PREVIEW', os.environ.get('PREVIEW', '') == '1'))
    reset_build()

    # 'planks' = dark boards INSIDE; plaster_exterior() below moves the outward
    # faces to cream plaster, so the inn is warm wood within and render without
    # (Troy, 2026-09-09: "some cozy wood texture inside").
    WALL_STYLE = 'planks'
    M = 2.5
    # 1.5x the ground (Troy, 2026-09-09: "make the size of the tavern 1.5x
    # bigger while keeping all of the assets inside the same size so there is
    # more space"): 25 x 15 instead of 17.5 x 10. Every prop stays at scale 1,
    # so the room simply gets roomier.
    HX, HY = 12.5, 7.5           # main hall half extents (25 x 15)
    WX, WY = 3.75, 10.0          # cross wing: 3 modules wide, front face at y = 10
    S = 1.85
    Z1 = 3.0                     # ground storey height
    Z2 = 6.0                     # wall top / eave
    XS = tuple(-11.25 + 2.5 * i for i in range(10))   # 10 modules across
    YS = tuple(-6.25 + 2.5 * i for i in range(6))     # 6 modules deep

    def band(pieces):
        """A wall pattern stretched over however many modules a run has."""
        return lambda i: pieces[i % len(pieces)]

    # ------------------------------------------------------------------
    # Ground floor (L0)
    # ------------------------------------------------------------------
    for x in XS:
        for y in YS:
            use('buildings/Floor_04', x, y, 0.1, 0, 'L0')
    for x in (-2.5, 0.0, 2.5):
        use('buildings/Floor_04', x, HY + 1.25, 0.1, 0, 'L0')

    # Back wall (-Y): windows and plain panels
    back = band(('HouseWall_11', 'HouseWall_02', 'HouseWall_06', 'HouseWall_02'))
    for i, x in enumerate(XS):
        use('buildings/' + back(i), x, -HY, 0, 0, 'L0')
    # Front wall (+Y): the wing fills the middle three modules (|x| < 3.75)
    front = band(('HouseWall_11', 'HouseWall_13', 'HouseWall_02', 'HouseWall_13'))
    for i, x in enumerate(XS):
        if abs(x) < WX:
            continue
        use('buildings/' + front(i), x, HY, 0, 0, 'L0')
    # Side walls
    side = band(('HouseWall_11', 'HouseWall_02', 'HouseWall_02'))
    for i, y in enumerate(YS):
        use('buildings/' + side(i), -HX, y, 0, math.pi / 2, 'L0')
        use('buildings/' + side(i), HX, y, 0, math.pi / 2, 'L0')
    # Cross wing: side walls out to the front face, then the front with the door
    use('buildings/HouseWall_11', -WX, HY + 1.25, 0, math.pi / 2, 'L0')
    use('buildings/HouseWall_11', WX, HY + 1.25, 0, math.pi / 2, 'L0')
    # Door in the CENTRE module, a window either side of it
    for x, piece in zip((-2.5, 0.0, 2.5), ('HouseWall_13', 'HouseWall_08', 'HouseWall_13')):
        use('buildings/' + piece, x, WY, 0, 0, 'L0')
    use('buildings/HouseDoor_01', -0.53, WY - 0.1, 0.0, -2.55, 'L0')  # ajar, hinge west
    for cx, cy in ((-HX, -HY), (-HX, HY), (HX, -HY), (HX, HY), (-WX, WY), (WX, WY)):
        use('buildings/Corner_04', cx, cy, 0, 0, 'L0')
    # Plinth course along the public faces, skipping the doorway
    for x in XS:
        if abs(x) < WX:
            continue
        use('buildings/HouseBase_01', x, HY + 0.16, 0, 0, 'L0')
    for x in (-2.5, 2.5):
        use('buildings/HouseBase_01', x, WY + 0.16, 0, 0, 'L0')

    # -- the hearth, west end: fireplace, fire, log basket, a rug and settles --
    use('buildings/Fireplace_01', -HX + 0.45, 0.0, 0.2, math.pi / 2, 'L0')
    use('props/Fire_01', -HX + 0.48, 0.0, 0.32, 0, 'L0')
    use('props/Firewood_01', -HX + 0.62, -2.2, 0.2, 0.4, 'L0')
    use('props/Carpet_01', -9.2, 0.0, 0.21, math.pi / 2, 'L0', sx=1.8, sy=1.8)  # red: Carpet_02/04/05 are blue
    # Stools round the hearth table, not chairs (Troy: "the 2 chairs need to be
    # removed in place of some stools"), each turned to face the fire.
    use('props/Table_01', -9.0, 0.0, 0.2, 0.0, 'L0')
    use('props/Furniture_08', -8.2, 1.1, 0.2, -math.pi / 2, 'L0')
    use('props/Furniture_08', -8.2, -1.1, 0.2, math.pi / 2, 'L0')
    use('props/Furniture_08', -9.8, 0.0, 0.2, 0.0, 'L0')
    use('props/Cup_02', -8.85, 0.15, 0.94, 0.7, 'L0')
    use('props/Book_03', -8.65, -0.2, 0.94, 0.3, 'L0')

    # -- the bar: a long run along the back wall, keeper's side to the wall --
    BAR_Y = -HY + 2.4  # keeper's room behind the counter
    for x in (-1.25, 0.0, 1.25, 2.5, 3.75, 5.0, 6.25):
        use('props/BarCounter_01', x, BAR_Y, 0.2, math.pi, 'L0')
    use('props/BarCounter_02', -2.49, BAR_Y, 0.2, math.pi, 'L0')
    use('props/BarCounter_02', 7.49, BAR_Y, 0.2, 0, 'L0')
    for x in (-1.0, 0.6, 2.4, 4.0, 5.6, 7.0):
        # Shelves OPEN to the room: rz = pi puts the cabinet's back panel
        # against the back wall instead of facing the customers.
        use('props/Furniture_03', x, -HY + 0.45, 0.2, math.pi, 'L0')
    use('props/Barrel_03', 5.6, -HY + 0.6, 0.2, 0.3, 'L0')
    use('props/Barrel_01', 6.4, -HY + 0.7, 0.2, 0.0, 'L0')
    for i, (x, b) in enumerate(((-1.9, 'Bottle_01'), (-0.6, 'Bottle_06'), (0.8, 'Bottle_03'), (2.2, 'Bottle_05'), (3.4, 'Bottle_02'))):
        use('props/' + b, x, BAR_Y - 0.05, 1.25, 0.4 * i, 'L0')
    use('props/PlateFood_01', 1.3, BAR_Y + 0.05, 1.25, 0.4, 'L0')
    use('props/Candle_01', -2.0, BAR_Y, 1.25, 0, 'L0')
    use('props/Candle_01', 4.4, BAR_Y, 1.25, 0, 'L0')
    for x in (-1.6, -0.2, 1.2, 2.6, 4.0, 5.4, 6.8):
        use('props/Furniture_08', x, BAR_Y + 0.8, 0.2, 0.25 * x, 'L0')

    # -- the middle of the room, under the open void: two feast tables --
    for ty in (4.0, 0.8, -2.4):
        use('props/Table_02', 0.0, ty, 0.2, 0, 'L0', sx=1.35)
        # Backs OUTWARD, seats to the table (the backrest is on the piece's +y
        # side at rz = 0, measured off the kit; the first cut had both benches
        # sitting with their backs against the boards, Troy, 2026-09-09).
        use('props/Furniture_14', 0.0, ty + 0.78, 0.2, 0, 'L0')
        use('props/Furniture_14', 0.0, ty - 0.78, 0.2, math.pi, 'L0')
        use('props/Candle_05', -1.2, ty, 0.87, 0, 'L0')
        use('props/Candle_05', 1.2, ty, 0.87, 0, 'L0')
    use('props/PlateFood_02', -0.4, 4.15, 0.87, 0.4, 'L0')
    use('props/Bottle_04', 0.5, 0.95, 0.87, 1.1, 'L0')
    use('props/Cup_02', 0.9, -2.2, 0.87, 2.4, 'L0')
    use('props/Scroll_02', -0.8, 0.55, 0.87, 0.2, 'L0')
    use('props/Carpet_01', 0.0, 0.8, 0.21, 0, 'L0', sx=3.4, sy=4.6)
    # More rugs: the room reads warm from the floor up.
    use('props/Carpet_01', -5.6, 4.6, 0.21, 0, 'L0', sx=1.8, sy=1.6)
    use('props/Carpet_01', 8.4, 1.0, 0.21, math.pi / 2, 'L0', sx=1.8, sy=1.6)
    use('props/Carpet_01', 0.0, HY + 1.3, 0.21, 0, 'L0', sx=1.8, sy=1.2)

    # -- snug alcoves in the cross wing, either side of the door --
    for sx_ in (-1, 1):
        use('props/Table_01', sx_ * 2.6, HY + 1.3, 0.2, 0.1 * sx_, 'L0')
        use('props/Furniture_08', sx_ * 2.6, HY + 1.95, 0.2, 0, 'L0')
        use('props/Furniture_08', sx_ * 2.6, HY + 0.65, 0.2, math.pi, 'L0')
        use('props/Candle_02', sx_ * 2.6, HY + 1.3, 0.94, 0, 'L0')
    use('props/NoticeBoard_01', WX - 0.35, HY + 0.9, 0.2, -math.pi / 2, 'L0')

    # -- east end: the stair up to the gallery, cellar clutter beneath --
    # Stairs_03 rises toward its LOCAL -X end; rz=+pi/2 puts the high end at -y.
    STX = 11.25  # the module centre the stairwell is cut over
    use('buildings/Stairs_03', STX, 1.9 + 1.925, 0.25, math.pi / 2, 'L0', sx=1.155, sy=1.5)
    # A third table group in the east bay, so the room is not half empty.
    for tx, ty2 in ((8.4, 3.6), (8.4, -1.8)):
        use('props/Table_01', tx, ty2, 0.2, 0.15, 'L0')
        use('props/Furniture_08', tx - 0.9, ty2 + 0.3, 0.2, -1.3, 'L0')
        use('props/Furniture_08', tx + 0.9, ty2 - 0.3, 0.2, 1.5, 'L0')
        use('props/Furniture_08', tx, ty2 - 1.0, 0.2, 0.1, 'L0')
        use('props/Candle_02', tx, ty2, 0.94, 0, 'L0')
        use('props/Cup_02', tx - 0.4, ty2 - 0.2, 0.94, 1.2, 'L0')
    use('props/Box_01', 9.9, -5.1, 0.2, 0.4, 'L0')
    use('props/Box_01', 9.85, -5.15, 0.55, 1.2, 'L0')
    use('props/Bag_02', 9.1, -5.9, 0.2, 0.3, 'L0')

    # -- walls: trophies, flags, a shield over the bar --
    use('props/Shield_02', 2.5, -HY + 0.18, 2.35, 0, 'L0')
    # On a WALL module: x = -2.5 is inside the wing's opening, so this one hung
    # in mid-air over the doorway (Troy: "a floating green flag on the left").
    use('props/Flag_03', -8.75, HY - 0.18, 2.75, math.pi, 'L0')
    use('props/Flag_02', 8.75, HY - 0.18, 2.75, math.pi, 'L0')
    use('props/Weapon_03', -HX + 0.2, -5.0, 2.2, math.pi / 2, 'L0')
    # Lighting. Three lamps hang from the ceiling joists down the length of the
    # room, a lantern flanks the door inside, and a pair of wall lanterns light
    # the bar, the ground storey is a 17.5 x 10 room, so one lamp would leave
    # both ends dark (Troy, 2026-09-09: "have some light sources in there that
    # look good"). Their glow is authored to match in citadel.ts
    # (TH_TAVERN_B_FLAMES).
    for lx, ly in ((-8.4, 0.0), (-3.0, 0.6), (3.0, 0.6), (8.4, 0.0)):
        use('props/Light_01', lx, ly, 2.72, 0, 'L0')
    use('props/Lantern_02', -HX + 0.28, -2.2, 1.95, math.pi / 2, 'L0')
    use('props/Lantern_02', -HX + 0.28, 3.6, 1.95, math.pi / 2, 'L0')
    use('props/Lantern_02', HX - 0.28, -2.2, 1.95, -math.pi / 2, 'L0')
    use('props/Lantern_02', HX - 0.28, 3.6, 1.95, -math.pi / 2, 'L0')
    use('props/Lantern_02', -1.6, -HY + 0.3, 2.05, 0, 'L0')
    use('props/Lantern_02', 5.2, -HY + 0.3, 2.05, 0, 'L0')
    use('props/Lantern_01', -1.5, WY - 0.35, 1.9, math.pi, 'L0')

    # ------------------------------------------------------------------
    # Upper storey (H1): a GALLERY round an open void over the hall
    # ------------------------------------------------------------------
    # A STAIRWELL, not a hole in the middle of the ceiling: the only opening in
    # the upper floor is the one the stair climbs through, over the east bay
    # (Troy: "the steps are moving into the celing and there is a big hole in
    # the celing at the wrong place not matching the steps"). Everything else is
    # a proper ceiling, which is also what lets the ground storey read clearly
    # when the upper one is hidden.
    STAIRWELL = {(11.25, 1.25), (11.25, 3.75)}
    for x in XS:
        for y in YS:
            if (x, y) in STAIRWELL:
                continue
            use('buildings/Floor_03', x, y, Z1 + 0.1, 0, 'H1')
    for x in (-2.5, 0.0, 2.5):
        use('buildings/Floor_03', x, HY + 1.25, Z1 + 0.1, 0, 'H1')  # over the wing
    # Rails round the stairwell's two open edges (the other two are walls); the
    # south edge is left open because that is where the stair arrives.
    for y in (1.25, 3.75):
        use('props/Fence_01', 10.0, y, Z1 + 0.2, math.pi / 2, 'H1')
    # Upper walls
    upper_back = band(('HouseWall_11', 'HouseWall_02', 'HouseWall_12', 'HouseWall_02'))
    for i, x in enumerate(XS):
        use('buildings/' + upper_back(i), x, -HY, Z1, 0, 'H1')
    upper_front = band(('HouseWall_11', 'HouseWall_02', 'HouseWall_12', 'HouseWall_02'))
    for i, x in enumerate(XS):
        if abs(x) < WX:
            continue
        use('buildings/' + upper_front(i), x, HY, Z1, 0, 'H1')
    upper_side = band(('HouseWall_02', 'HouseWall_11', 'HouseWall_11'))
    for i, y in enumerate(YS):
        use('buildings/' + upper_side(i), -HX, y, Z1, math.pi / 2, 'H1')
        use('buildings/' + upper_side(i), HX, y, Z1, math.pi / 2, 'H1')
    use('buildings/HouseWall_02', -WX, HY + 1.25, Z1, math.pi / 2, 'H1')
    use('buildings/HouseWall_02', WX, HY + 1.25, Z1, math.pi / 2, 'H1')
    for x, piece in zip((-2.5, 0.0, 2.5), ('HouseWall_11', 'HouseWall_11', 'HouseWall_11')):
        use('buildings/' + piece, x, WY, Z1, 0, 'H1')

    # Partition walls: the loft is two bedrooms and a landing, not one open
    # dormitory. Each partition leaves its middle module out as the doorway.
    for sx_ in (-1, 1):
        for y in (-6.25, -3.75, 3.75, 6.25):
            use('buildings/HouseWall_02', sx_ * 5.0, y, Z1, math.pi / 2, 'H1')
        use('props/Fence_01', sx_ * 5.0, 0.0, Z1 + 0.2, math.pi / 2, 'H1')

    # Bedrooms: two at each end, beds against the gable walls
    for sx_ in (-1, 1):
        bx = sx_ * 10.4
        # Headboards to the wall, same rule as the benches.
        use('props/Bed_02', bx, 5.9, Z1 + 0.2, 0, 'H1')
        use('props/Bed_01', bx, -5.9, Z1 + 0.2, math.pi, 'H1')
        use('props/Bed_03', bx - sx_ * 2.6, 5.9, Z1 + 0.2, 0, 'H1')
        use('props/Bed_04', bx - sx_ * 2.6, -5.9, Z1 + 0.2, math.pi, 'H1')
        use('props/Furniture_04', sx_ * 9.0, 6.9, Z1 + 0.2, 0, 'H1')
        use('props/Candle_04', sx_ * 9.0, 6.95, Z1 + 0.75, 0, 'H1')
        use('props/Chest_01', sx_ * 9.0, -6.9, Z1 + 0.2, 0, 'H1')
        use('props/Carpet_01', bx, 0.0, Z1 + 0.21, 0, 'H1', sx=1.2, sy=1.2)
        use('props/Carpet_01', sx_ * 6.0, 0.0, Z1 + 0.21, math.pi / 2, 'H1', sx=1.6, sy=1.5)
    # The reading nook over the porch, in the wing
    use('props/Table_01', 0.0, HY + 1.3, Z1 + 0.2, 0, 'H1')
    use('props/Furniture_08', -0.9, HY + 1.3, Z1 + 0.2, 1.4, 'H1')
    use('props/Furniture_08', 0.9, HY + 1.3, Z1 + 0.2, -1.4, 'H1')
    use('props/Book_03', 0.0, HY + 1.3, Z1 + 0.94, 0.3, 'H1')
    use('props/Candle_02', 0.45, HY + 1.4, Z1 + 0.94, 0, 'H1')
    use('props/Flag_01', -HX + 0.2, 0.0, Z1 + 2.6, math.pi / 2, 'H1')
    for lx in (-8.0, -2.6, 2.6, 8.0):
        use('props/Light_01', lx, 0.0, Z1 + 2.72, 0, 'H1')
    use('props/Lantern_02', 9.9, 0.6, Z1 + 1.95, math.pi / 2, 'H1')  # over the stairwell

    # ------------------------------------------------------------------
    # Roof (H2), main ridge along X, cross gable over the wing, tower,
    # dormer, chimney
    # ------------------------------------------------------------------
    RSX, RSY, RSZ = 2.40, 1.88, 1.55
    z_roof = Z2 - 3.587 * RSZ
    Z_RIDGE = z_roof + 8.354 * RSZ
    roof = use('buildings/HouseRoof_05', 0, 0, z_roof, 0, 'H2', sx=RSX, sy=RSY, sz=RSZ)
    retint_roof([roof])
    HALF_EAVE = 4.291 * RSY - 0.12
    gable_solid(HX + 0.08, Z2, Z_RIDGE, HALF_EAVE, axis='x', grp='H2')
    gable_solid(-(HX + 0.08), Z2, Z_RIDGE, HALF_EAVE, axis='x', grp='H2')

    # Cross gable over the wing: same piece turned a quarter, ridge along Y.
    WSX, WSY, WSZ = 0.62, 0.95, 1.00
    w_roof_z = Z2 - 3.587 * WSZ
    W_RIDGE = w_roof_z + 8.354 * WSZ
    wroof = use('buildings/HouseRoof_05', 0.0, HY - 0.4, w_roof_z, math.pi / 2, 'H2', sx=WSX, sy=WSY, sz=WSZ)
    retint_roof([wroof])
    W_HALF = 4.291 * WSY - 0.1
    gable_solid(WY + 0.08, Z2, W_RIDGE, W_HALF, axis='y', grp='H2')
    # A little window in the cross gable, under the apex, so the face is not bare
    use('buildings/HouseWall_11', 0.0, WY - 0.02, Z2 + 0.45, 0, 'H2', s=0.62)

    # The belfry: a slender shaft over the crossing, lantern windows, spire.
    TZ0 = Z_RIDGE - 1.2
    for ang, (tx, ty) in zip((0, math.pi, math.pi / 2, -math.pi / 2),
                             ((0.0, 1.25), (0.0, -1.25), (1.25, 0.0), (-1.25, 0.0))):
        use('buildings/HouseWall_11', tx, ty, TZ0, ang, 'H2')
    for cx, cy in ((-1.25, -1.25), (-1.25, 1.25), (1.25, -1.25), (1.25, 1.25)):
        use('buildings/Corner_01', cx, cy, TZ0, 0, 'H2', sz=3.0 / 3.7)
    TSX = TSY = 0.30
    TSZ = 0.55
    t_roof_z = TZ0 + 3.0 - 3.587 * TSZ
    troof = use('buildings/HouseRoof_05', 0.0, 0.0, t_roof_z, 0, 'H2', sx=TSX, sy=TSY, sz=TSZ)
    retint_roof([troof])
    use('props/Light_01', 0.0, 0.0, TZ0 + 2.4, 0, 'H2')

    # Dormer in the front slope, left of the wing (HouseRoof_07 is a small
    # GABLE: its ridge runs along local y, so rz=0 points the gable at +Y).
    # No dormer: it read as a lump stuck on the slope from every angle and Troy
    # asked for it gone (2026-09-09). The belfry and the cross gable already give
    # the roof its silhouette.

    # Chimney: the hearth is at the west wall, so the stack rises off that end.
    use('buildings/Chimney_01', -HX + 0.9, 0.0, Z_RIDGE - 2.6, 0, 'H2', s=1.35)

    # ------------------------------------------------------------------
    # Porch, awnings and the yard (L0)
    # ------------------------------------------------------------------
    # Porch roof on two posts over the door. Lean-to rule (bank, 2026-09-08):
    # HouseRoof_07 is a GABLE, so lay its ridge ACROSS the doorway and let both
    # slopes fall to the sides; posts carry the outer corners.
    # The entrance porch is a ROOM, not an awning: 10 wide and 5 deep on four
    # posts with its own gabled roof, so a table and benches fit under cover
    # (Troy: "make this overhang with the window much bigger so a small room
    # could fit in that overhang"). Its gable, the face carrying the round
    # window, looks down the street.
    PORCH_HX, PORCH_OUT, PORCH_Z = 5.0, 5.0, 3.4
    use('buildings/HouseRoof_07', 0.0, WY + PORCH_OUT - 2.4, PORCH_Z, 0, 'L0',
        sx=2.85, sy=2.05, sz=1.05)
    for px in (-PORCH_HX + 0.3, PORCH_HX - 0.3):
        for py in (WY + 1.0, WY + PORCH_OUT - 0.4):
            use('buildings/Corner_01', px, py, 0, 0, 'L0', sz=PORCH_Z / 3.70)
        use('buildings/HouseBase_01', px, WY + 0.4, PORCH_Z - 0.3, math.pi / 2, 'L0', sx=0.5)
    use('props/Table_02', 0.0, WY + 2.9, 0.2, 0, 'L0')
    use('props/Furniture_14', 0.0, WY + 3.65, 0.2, 0, 'L0')
    use('props/Furniture_14', 0.0, WY + 2.15, 0.2, math.pi, 'L0')
    use('props/Barrel_01', -PORCH_HX + 0.9, WY + 4.0, 0, 0.3, 'L0')
    use('props/Box_02', PORCH_HX - 1.0, WY + 4.0, 0, 0.2, 'L0')

    steps(0.0, WY + 0.22, 0, 3.6, 2, 0.2)
    use('props/SignBoard_05', WX + 0.12, WY - 1.2, 2.45, math.pi, 'L0')
    use('props/Lantern_01', -1.5, WY + 0.45, 0, math.pi, 'L0')
    use('props/Lantern_01', 1.5, WY + 0.45, 0, math.pi, 'L0')
    # Cloth awnings at both ends of the hall, wares beneath
    for sx_ in (-1, 1):
        # Ridge OUT from the end wall (rz = +-pi/2 about the wall normal), so the
        # gable and its window face away from the building, and the roof reaches
        # back to the wall.
        use('buildings/HouseRoof_07', sx_ * (HX + 1.05), 2.2, 3.0, math.pi / 2, 'L0', sx=1.5, sy=1.35, sz=0.7)
        use('buildings/Corner_01', sx_ * (HX + 1.95), 0.9, 0, 0, 'L0', sz=3.0 / 3.70)
        use('buildings/Corner_01', sx_ * (HX + 1.95), 3.5, 0, 0, 'L0', sz=3.0 / 3.70)
        use('buildings/HouseBase_01', sx_ * (HX + 1.0), 0.9, 2.75, 0, 'L0', sx=0.8)
        use('buildings/HouseBase_01', sx_ * (HX + 1.0), 3.5, 2.75, 0, 'L0', sx=0.8)
    use('props/Barrel_01', -HX - 1.0, 3.6, 0, 0, 'L0')
    use('props/Barrel_02', -HX - 1.6, 2.9, 0, 0.7, 'L0')
    use('props/Box_01', HX + 1.0, 3.3, 0, 0.4, 'L0')
    use('props/Box_02', HX + 1.1, 2.4, 0, 0.2, 'L0')
    use('props/Table_01', HX + 1.2, 1.2, 0, 0.3, 'L0')
    use('nature/FlowerPot_02', -3.3, WY + 0.7, 0, 0.4, 'L0')
    use('nature/FlowerPot_05', 3.3, WY + 0.7, 0, 1.2, 'L0')
    use('props/Furniture_14', -5.6, HY + 0.6, 0, 0, 'L0')
    use('props/Furniture_14', 5.6, HY + 0.6, 0, 0, 'L0')

    # ------------------------------------------------------------------
    # Collision: walls as thin runs, the floors as walkable decks
    # ------------------------------------------------------------------
    T = 0.24
    col_wall(-HX, -HY, HX, -HY, 0, Z2, T)              # back
    col_wall(-HX, -HY, -HX, HY, 0, Z2, T)              # west
    col_wall(HX, -HY, HX, HY, 0, Z2, T)                # east
    col_wall(-HX, HY, -WX, HY, 0, Z2, T)               # front, west of the wing
    col_wall(WX, HY, HX, HY, 0, Z2, T)                 # front, east of the wing
    col_wall(-WX, HY, -WX, WY, 0, Z2, T)               # wing west
    col_wall(WX, HY, WX, WY, 0, Z2, T)                 # wing east
    col_wall(-WX, WY, -1.15, WY, 0, Z2, T)             # wing front, west of the door
    col_wall(1.15, WY, WX, WY, 0, Z2, T)               # wing front, east of the door
    col(0.0, WY, Z1 + 1.6, 1.15, T, 1.4)               # lintel + wall over the door
    col(-HX + 0.5, 0.0, 1.1, 0.55, 1.4, 1.1)           # the hearth breast
    col(1.25, BAR_Y, 0.55, 4.6, 0.45, 0.55)            # the bar
    for tx in (8.4,):                                  # the east table groups
        col(tx, 3.6, 0.5, 1.3, 1.1, 0.5)
        col(tx, -1.8, 0.5, 1.3, 1.1, 0.5)
    col(2.0, -HY + 0.45, 1.0, 3.4, 0.3, 1.0)           # back shelves
    for ty in (4.0, 0.8, -2.4):
        col(0.0, ty, 0.5, 1.9, 0.75, 0.5)              # feast tables
    for sx_ in (-1, 1):
        col(sx_ * 2.6, HY + 1.3, 0.5, 0.9, 0.9, 0.5)   # snug alcoves
        col_wall(sx_ * 5.0, -HY, sx_ * 5.0, -2.5, Z1, Z1 + 3.0, 0.2)     # loft partition
        col_wall(sx_ * 5.0, 2.5, sx_ * 5.0, HY, Z1, Z1 + 3.0, 0.2)
        col(sx_ * (HX + 1.95), 2.2, 1.5, 0.2, 1.5, 1.5)    # canopy posts
    for px in (-PORCH_HX + 0.3, PORCH_HX - 0.3):       # porch posts
        for py in (WY + 1.0, WY + PORCH_OUT - 0.4):
            col(px, py, 1.7, 0.2, 0.2, 1.7)
    col(0.0, WY + 2.9, 0.5, 1.9, 0.9, 0.5)             # the porch table
    # The stair: a rising deck along the treads, then the gallery floor.
    ramp(STX, 1.9 + 1.925, 0.9, 1.925, -math.pi / 2, 0.28, Z1 + 0.2)
    # Gallery decks (the void in the middle is left open on purpose)
    # The upper floor is solid but for the stairwell (x 6.25..8.75, y 0..5).
    col(-1.25, 0.0, Z1 + 0.14, 11.25, HY, 0.08)        # everything west of it
    col(11.25, -3.75, Z1 + 0.14, 1.25, 3.75, 0.08)     # east bay + stair landing
    col(0.0, HY + 1.25, Z1 + 0.14, WX, 1.25, 0.08)     # the wing nook
    col(10.0, 2.5, Z1 + 0.75, 0.12, 2.5, 0.55)         # stairwell rail
    interior(-HX + 0.2, HX - 0.2, -HY + 0.2, HY - 0.2, 0.0, Z_RIDGE)
    interior(-WX + 0.2, WX - 0.2, HY - 0.2, WY - 0.2, 0.0, W_RIDGE)

    plaster_exterior()
    flatten_tiles()
    # flatten_tiles puts EVERY Floor_* slab on the stone-tile material, which
    # reads cold in the bedrooms. The upper storey uses Floor_03 and nothing
    # else does, so re-materialling that one template gives the second floor
    # its boards (Troy: "a wooden floor on the 2nd floor").
    _pmat = plank_material()
    for _me in bpy.data.meshes:
        if 'Floor_03' in _me.name:
            _me.materials.clear()
            _me.materials.append(_pmat)
            _planar_uvs(_me, 0.42)
    dissolve_planar()
    decimate_slabs()

    def cam_shot(path, eye, target, size=(1200, 900), fov=44.0, samples=18):
        # Headless Blender has no GPU viewport, so the previews are Cycles
        # camera renders (the same trick the Deepglass prop scripts use).
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        cam_data = bpy.data.cameras.new('_prev_cam')
        cam_data.angle = math.radians(fov)
        cam_data.clip_end = 3000.0
        cam = bpy.data.objects.new('_prev_cam', cam_data)
        sc.collection.objects.link(cam)
        cam.location = Vector(eye)
        cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam
        sc.render.resolution_x, sc.render.resolution_y = size
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = 'PNG'
        sc.render.filepath = path
        sc.cycles.samples = samples
        sc.cycles.use_denoising = False
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)
        bpy.data.cameras.remove(cam_data)

    if PREVIEW:
        # Preview-only lamps INSIDE, so the interior can actually be judged: a
        # sun outside leaves a shell this size pitch black. Never exported.
        for i, (lx, ly, lz, pw) in enumerate((
            (-4.6, 0.0, 2.5, 900.0), (0.0, 0.6, 2.5, 900.0), (4.6, 0.0, 2.5, 900.0),
            (-6.0, 0.0, 1.4, 400.0), (0.0, 6.0, 2.3, 500.0), (7.0, 2.0, 2.4, 500.0),
            (-4.6, 0.0, 5.5, 700.0), (4.6, 0.0, 5.5, 700.0),
        )):
            ld = bpy.data.lights.new(f'_pl{i}', 'POINT')
            ld.energy = pw
            ld.shadow_soft_size = 1.2
            ld.color = (1.0, 0.86, 0.66)
            lo = bpy.data.objects.new(f'_pl{i}', ld)
            lo.location = (lx, ly, lz)
            bpy.context.scene.collection.objects.link(lo)
        sun = bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN'))
        sun.data.energy = 3.2
        sun.rotation_euler = (math.radians(52), 0.0, math.radians(35))
        bpy.context.scene.collection.objects.link(sun)
        cam_shot(SCRATCH + '/tavb_front.png', (17.0, 26.0, 12.0), (0.0, 2.0, 6.0))
        cam_shot(SCRATCH + '/tavb_elev.png', (0.0, 30.0, 7.0), (0.0, 0.0, 6.5), fov=40)
        cam_shot(SCRATCH + '/tavb_side.png', (-25.0, 15.0, 11.0), (0.0, 0.0, 6.0))
        for o in list(_GROUPS.get('H2').children):
            o.hide_render = True
        cam_shot(SCRATCH + '/tavb_int.png', (8.0, 3.6, 2.6), (-6.5, -1.0, 1.2), fov=80, samples=40)
        cam_shot(SCRATCH + '/tavb_int2.png', (-7.8, 3.6, 2.5), (6.0, -2.0, 1.1), fov=80)
        cam_shot(SCRATCH + '/tavb_int3.png', (0.0, 7.0, 2.2), (0.0, -4.5, 1.3), fov=82)
        cam_shot(SCRATCH + '/tavb_stair.png', (3.0, -3.2, 2.6), (8.4, 3.0, 1.6), fov=80)
        cam_shot(SCRATCH + '/tavb_plan.png', (0.0, 0.01, 26.0), (0.0, 0.0, 0.0), size=(1200, 1000), fov=46)
        for o in list(_GROUPS.get('L0').children):
            o.hide_render = True
        cam_shot(SCRATCH + '/tavb_up.png', (-7.8, 3.4, 5.4), (6.5, -1.5, 3.9), fov=82)
        cam_shot(SCRATCH + '/tavb_planup.png', (0.0, 0.01, 26.0), (0.0, 0.0, 3.0), size=(1200, 1000), fov=46)
        for o in list(_GROUPS.get('L0').children):
            o.hide_render = False
        for o in list(_GROUPS.get('H2').children):
            o.hide_render = False
        cam_shot(SCRATCH + '/tavb_porch.png', (2.5, 20.0, 3.4), (0.0, 8.0, 3.0), fov=48)
        cam_shot(SCRATCH + '/tavb_end.png', (-24.0, 7.0, 4.5), (-8.0, 2.0, 3.5), fov=48)
        LOG.append('preview only')
    else:
        finalize('tidehold_tavern_b', SCRATCH + '/out', S)
        LOG.append('finalized')
    LOG.append('done')
except Exception:
    LOG.append(traceback.format_exc())
print('\n'.join(str(x) for x in LOG))
