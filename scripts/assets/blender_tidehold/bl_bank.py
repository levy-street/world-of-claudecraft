# Tide's Coffer, the bank, rebuilt as a proper medieval shop (Troy's concept:
# stone ground floor, plaster + timber upper storey, a cross-gabled front
# wing with the door, an awning over the shop window, steep slate roofs).
# L-plan: main block 12.5 x 7.5 kit units (front +Y) with a 5 x 2.5 wing
# stepping forward on the west half. Ground walls are the 5-tall castle stone,
# the upper storey the 3-tall house walls (plaster), wall top at 8. S = 1.85.
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/b3a5eb48-37dc-4429-b53c-25163d3a9b01/scratchpad/bl'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    exec(open(SCRATCH + '/bl_lite.py').read())
    FLOOR_DEFAULT = 'tiles'
    exec(open(SCRATCH + '/bl_forge.py').read())
    reset_build()
    WALL_STYLE = 'plaster'   # upper-storey house walls: cream plaster between the timbers
    M = 2.5
    HX, HY = 6.25, 3.75          # main block half extents
    WX0, WX1, WXC = -6.25, -1.25, -3.75   # wing x span + centre
    WY = HY + 2.5                # wing front
    S = 1.85
    Z1 = 5.0                     # ground storey (castle walls)
    Z2 = Z1 + 3.0                # wall top (house walls)
    XS = (-5.0, -2.5, 0.0, 2.5, 5.0)
    YS = (-2.5, 0.0, 2.5)

    # ---------------- floors ----------------
    for x in XS:
        for y in YS:
            use('buildings/Floor_06', x, y, 0.1, 0, 'L0')
    for x in (-5.0, -2.5):
        use('buildings/Floor_06', x, 5.0, 0.1, 0, 'L0')

    # ---------------- ground storey: castle stone (L0) ----------------
    # Main front (+Y), east of the wing: the SHOP WINDOW bay (two windows) + plain
    for x, piece in zip((0.0, 2.5, 5.0), ('CastleWall_04', 'CastleWall_04', 'CastleWall_01')):
        use('buildings/' + piece, x, HY, 0, 0, 'L0')
    # Wing front: the 5-wide arch with double doors swung inward
    use('buildings/CastleWall_06', WXC, WY, 0, 0, 'L0')
    use('buildings/CastleDoor_02', WXC - 0.95, WY - 0.15, 0, -1.9, 'L0')
    use('buildings/CastleDoor_03', WXC + 0.95, WY - 0.15, 0, 1.82, 'L0')
    # Wing sides: west solid, east a window on the street
    use('buildings/CastleWall_01', WX0, 5.0, 0, math.pi / 2, 'L0')
    use('buildings/CastleWall_04', WX1, 5.0, 0, math.pi / 2, 'L0')
    # Back
    for x, piece in zip(XS, ('CastleWall_01', 'CastleWall_04', 'CastleWall_01', 'CastleWall_04', 'CastleWall_01')):
        use('buildings/' + piece, x, -HY, 0, 0, 'L0')
    # Sides
    for y, piece in zip(YS, ('CastleWall_01', 'CastleWall_04', 'CastleWall_01')):
        use('buildings/' + piece, -HX, y, 0, math.pi / 2, 'L0')
    for y, piece in zip(YS, ('CastleWall_04', 'CastleWall_01', 'CastleWall_04')):
        use('buildings/' + piece, HX, y, 0, math.pi / 2, 'L0')
    CORNERS = ((-HX, -HY), (HX, -HY), (HX, HY), (WX1, HY), (WX1, WY), (WX0, WY))
    for cx, cy in CORNERS:
        use('buildings/CastleCorner_01', cx, cy, 0, 0, 'L0')
    # Skirting along the street faces
    for x in (0.0, 2.5, 5.0):
        use('buildings/CastleBase_01', x, HY + 0.2, 0, 0, 'L0')
    use('buildings/CastleBase_01', WX1 + 0.2, 5.0, 0, math.pi / 2, 'L0')

    # ---------------- upper storey: plaster + timber (H1) ----------------
    # main front east of the wing
    for x, piece in zip((0.0, 2.5, 5.0), ('HouseWall_13', 'HouseWall_11', 'HouseWall_12')):
        use('buildings/' + piece, x, HY, Z1, 0, 'H1')
    # wing front (two big windows), wing sides
    use('buildings/HouseWall_13', -5.0, WY, Z1, 0, 'H1')
    use('buildings/HouseWall_13', -2.5, WY, Z1, 0, 'H1')
    use('buildings/HouseWall_02', WX0, 5.0, Z1, math.pi / 2, 'H1')
    use('buildings/HouseWall_11', WX1, 5.0, Z1, math.pi / 2, 'H1')
    # back, sides
    for x, piece in zip(XS, ('HouseWall_11', 'HouseWall_02', 'HouseWall_12', 'HouseWall_02', 'HouseWall_11')):
        use('buildings/' + piece, x, -HY, Z1, 0, 'H1')
    for y, piece in zip(YS, ('HouseWall_12', 'HouseWall_02', 'HouseWall_11')):
        use('buildings/' + piece, -HX, y, Z1, math.pi / 2, 'H1')
    for y, piece in zip(YS, ('HouseWall_11', 'HouseWall_02', 'HouseWall_12')):
        use('buildings/' + piece, HX, y, Z1, math.pi / 2, 'H1')
    for cx, cy in CORNERS:
        use('buildings/Corner_01', cx, cy, Z1, 0, 'H1', sz=3.0 / 3.70)
    # The storey band: a timber beam along every upper wall base, with
    # brackets under it (the concept's jettied look without the overhang).
    BZ0, BZ1 = Z1 - 0.18, Z1 + 0.14
    def band(x0, y0, x1, y1, out):
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L
        cx, cy = (x0 + x1) / 2 + nx * out, (y0 + y1) / 2 + ny * out
        wood_box(cx, cy, BZ0, BZ1, L / 2 + 0.12, 0.13, math.atan2(dy, dx), 'H1')
        n = max(1, int(L / 1.25))
        for i in range(n):
            f = (i + 0.5) / n
            wood_box(x0 + dx * f + nx * (out - 0.02), y0 + dy * f + ny * (out - 0.02), BZ0 - 0.42, BZ0, 0.09, 0.09, math.atan2(dy, dx), 'H1')
    band(WX1, HY, HX, HY, 0.24)        # main front (east of the wing)
    band(HX, HY, HX, -HY, 0.24)        # east
    band(HX, -HY, -HX, -HY, 0.24)      # back
    band(-HX, -HY, -HX, WY, 0.24)      # west (main + wing)
    band(WX0, WY, WX1, WY, 0.24)       # wing front
    band(WX1, WY, WX1, HY, 0.24)       # wing east side
    # Gold string course above the window heads, under the storey brackets
    brass_run(WX1, HY, HX, HY, 4.05, 0.24)
    brass_run(HX, HY, HX, -HY, 4.05, 0.24)
    brass_run(HX, -HY, -HX, -HY, 4.05, 0.24)
    brass_run(-HX, -HY, -HX, WY, 4.05, 0.24)
    brass_run(WX1, WY, WX1, HY, 4.05, 0.24)

    # ---------------- upper floor + stairs ----------------
    # Floor over the main block, stairwell open along the east wall (front half)
    for x in XS:
        for y in YS:
            if x == 5.0 and y in (0.0, 2.5):
                continue
            use('buildings/Floor_03', x, y, Z1 + 0.1, 0, 'H1')
    for x in (-5.0, -2.5):
        use('buildings/Floor_03', x, 5.0, Z1 + 0.1, 0, 'H1')
    # Stairs_03 rises toward its LOCAL -X end; rz=+pi/2 puts the high end at
    # kit -y. Scaled to the 5-unit storey. Origin (low end) near the front.
    STX, ST_Y0 = 5.25, 2.6
    SSX, SSZ = 1.4, Z1 / 3.1
    use('buildings/Stairs_03', STX, ST_Y0, 0.2, math.pi / 2, 'L0', sx=SSX, sy=1.4, sz=SSZ)
    y_lo, y_hi = ST_Y0 + 0.25 * SSX, ST_Y0 - 3.43 * SSX          # treads span (kit y)
    # Guard rails round the stairwell on the upper floor
    for y in (0.0, 1.5, 3.0):
        use('props/Fence_01', 4.35, y, Z1 + 0.2, math.pi / 2, 'H1')

    # ---------------- interior: the shop floor ----------------
    # Counter across the room facing the door (through the wing)
    for tx in (-1.6, -0.35, 0.9):
        use('props/BarCounter_03', tx, -0.6, 0.1, math.pi, 'L0')
    use('props/Scroll_02', -1.55, -0.65, 1.16, 0.4, 'L0')
    use('props/Ink_01', -0.3, -0.7, 1.16, 0, 'L0')
    use('props/Book_05', 0.95, -0.65, 1.16, 1.2, 'L0')
    use('props/Candle_01', 1.3, -0.7, 1.16, 0, 'L0')
    # Shelves along the back wall, the clerk's desk
    # Back to the wall: a piece's back is on its +y side at rz 0.
    use('props/Furniture_03', 0.5, -HY + 0.3, 0.1, math.pi, 'L0')
    use('props/Furniture_03', 1.9, -HY + 0.3, 0.1, math.pi, 'L0')
    use('props/Furniture_03', 3.3, -HY + 0.3, 0.1, math.pi, 'L0')
    use('props/Furniture_09', -1.6, -2.6, 0.1, 0, 'L0')
    use('props/Furniture_08', -1.6, -2.0, 0.1, math.pi, 'L0')
    use('props/Book_11', 0.55, -HY + 0.32, 1.32, 0.7, 'L0')
    use('props/Potion_02', 1.95, -HY + 0.32, 1.32, 0, 'L0')
    use('props/Book_09', -1.5, -2.6, 0.95, 0.4, 'L0')
    use('props/Carpet_05', -0.35, -1.8, 0.215, 0.0, 'L0', sx=1.6, sy=1.2)
    # The vault: west-back corner behind columns + a portcullis
    use('buildings/CastlePart_02', -3.6, -0.6, 0, 0, 'L0')
    use('buildings/CastlePart_02', -3.6, -3.3, 0, 0, 'L0')
    use('environment/WallGate_01', -3.62, -1.95, 0, math.pi / 2, 'L0', s=0.82)
    use('props/Chest_01', -5.55, -1.3, 0.1, math.pi / 2, 'L0')
    use('props/Chest_01', -5.6, -2.3, 0.1, math.pi / 2, 'L0')
    use('props/Chest_01', -4.8, -3.2, 0.1, 0.1, 'L0')
    use('props/Bag_01', -4.4, -1.2, 0.1, 0.3, 'L0')
    use('props/Bag_03', -4.9, -2.1, 0.1, 1.1, 'L0')
    use('props/Candle_05', -5.7, -0.5, 0.1, 0.2, 'L0')
    # Goods by the shop window (inside): crates, barrels, a display table
    use('props/Table_02', 1.4, 2.6, 0.1, 0, 'L0')
    use('props/PlateFood_02', 0.7, 2.6, 0.77, 0.4, 'L0')
    use('props/Cup_03', 1.9, 2.5, 0.77, 0, 'L0')
    use('props/Barrel_01', 4.4, 2.9, 0.1, 0, 'L0')
    use('props/Barrel_02', 5.2, 2.6, 0.1, 0.8, 'L0')
    use('props/Box_01', 3.6, 3.1, 0.1, 0.4, 'L0')
    use('props/Box_01', 3.55, 3.05, 0.45, 1.2, 'L0')
    # The wing: waiting bench, notice board, runner to the counter
    use('props/Furniture_14', WX0 + 0.55, 5.0, 0.1, math.pi / 2, 'L0')
    use('props/NoticeBoard_01', WX1 - 0.4, 4.4, 0.1, -math.pi / 2, 'L0')
    for cy in (5.2, 3.8, 2.4, 1.0):
        use('props/Carpet_04', WXC, cy, 0.215, math.pi / 2, 'L0')
    # Lights
    use('props/Light_01', 0.5, 0.6, Z1 - 0.4, 0, 'L0')
    use('props/Light_01', -4.0, -1.8, Z1 - 0.4, 0, 'L0')
    use('props/Light_01', WXC, 5.0, Z1 - 0.4, 0, 'L0')
    use('props/Flag_02', -HX + 0.18, 1.0, 3.9, math.pi / 2, 'L0')
    use('props/Flag_02', HX - 0.18, -2.4, 3.9, -math.pi / 2, 'L0')

    # ---------------- interior: the counting room upstairs ----------------
    use('props/Furniture_09', -2.0, -2.5, Z1 + 0.2, 0, 'H1')
    use('props/Furniture_08', -2.0, -1.8, Z1 + 0.2, math.pi, 'H1')
    use('props/Book_03', -2.2, -2.5, Z1 + 1.02, 0.3, 'H1')
    use('props/Candle_02', -1.6, -2.55, Z1 + 1.02, 0, 'H1')
    use('props/Furniture_03', 1.0, -HY + 0.3, Z1 + 0.2, math.pi, 'H1')
    use('props/Furniture_03', 2.4, -HY + 0.3, Z1 + 0.2, math.pi, 'H1')
    use('props/Chest_01', -5.6, -3.2, Z1 + 0.2, 0, 'H1')
    use('props/Chest_01', -5.6, 0.4, Z1 + 0.2, math.pi / 2, 'H1')
    use('props/Carpet_05', -1.5, 0.2, Z1 + 0.21, 0, 'H1', sx=1.6, sy=1.6)
    use('props/Table_01', -3.9, 4.9, Z1 + 0.2, 0.2, 'H1')
    use('props/Furniture_08', -4.7, 4.5, Z1 + 0.2, 0.9, 'H1')
    use('props/Furniture_08', -3.1, 5.3, Z1 + 0.2, -2.0, 'H1')
    use('props/Cup_02', -4.0, 4.8, Z1 + 0.94, 0.7, 'H1')
    use('props/Bag_02', 2.6, -3.1, Z1 + 0.2, 0.8, 'H1')
    use('props/Light_01', -1.0, 0.0, Z2 + 1.6, 0, 'H1')
    use('props/Light_01', WXC, 5.0, Z2 + 1.2, 0, 'H1')

    # ---------------- roofs (H2) ----------------
    # Main gable roof along x over the 12.5 x 7.5 block (tavern scaling in x)
    RSX, RSY, RSZ = 1.227, 0.99, 1.25
    z_roof = Z2 - 3.587 * RSZ
    Z_RIDGE = z_roof + 8.354 * RSZ
    roof = use('buildings/HouseRoof_05', 0, 0, z_roof, 0, 'H2', sx=RSX, sy=RSY, sz=RSZ)
    HALF_EAVE = 4.291 * RSY - 0.12
    SLOPE = (Z_RIDGE - Z2) / (4.291 * RSY)        # rise per unit y on the main roof
    gable_solid(HX + 0.08, Z2, Z_RIDGE, HALF_EAVE, axis='x', grp='H2')
    gable_solid(-(HX + 0.08), Z2, Z_RIDGE, HALF_EAVE, axis='x', grp='H2')
    # Cross-gabled wing roof: HouseRoof_02 (ridge along y) over the wing,
    # running back until it meets the main slope; the part buried under the
    # main roof is cut away along that slope so the upstairs ceiling is clean.
    WSY, WSZ = 0.98, 1.25
    wz = Z2 - 3.59 * WSZ
    W_RIDGE = wz + 7.18 * WSZ
    wyc = 3.6
    wing = use('buildings/HouseRoof_02', WXC, wyc, wz, 0, 'H2', sx=1.0, sy=WSY, sz=WSZ)
    # main front slope plane, world: z = Z_RIDGE - SLOPE*y  ->  in wing-local
    # coords (y = wyc + WSY*yl, z = wz + WSZ*zl): WSZ*zl + SLOPE*WSY*yl + (wz + SLOPE*wyc - Z_RIDGE) = 0
    k0 = wz + SLOPE * wyc - Z_RIDGE
    cut_local_y(wing, -2.9, keep='above')   # the kit's back gable cap would poke out of the main slope
    cut_local_plane(wing, (0.0, 0.0, -k0 / WSZ), (0.0, SLOPE * WSY, WSZ), keep_positive=True)
    retint_roof([roof, wing])
    gable_solid(WY + 0.3, Z2, W_RIDGE, 2.85 - 0.1, axis='y', grp='H2', center=WXC)
    # Chimney on the back slope
    use('buildings/Chimney_01', 3.6, -1.9, Z_RIDGE - SLOPE * 1.9 - 0.5, 0, 'H2', sz=2.2)
    # Ivy draped along the east gable (the tavern's trick)
    IVY_SX = (2 * HALF_EAVE) / 8.76
    IVY_SZ = (Z_RIDGE - Z2) / (5.03 + 0.34)
    use('nature/Ivy_02', HX + 0.45, 0.0, Z2 + 0.34 * IVY_SZ, math.pi / 2, 'H2', sx=IVY_SX, sy=1.0, sz=IVY_SZ)

    # ---------------- exterior dressing ----------------
    # Awning over the shop window bay. HouseRoof_07 is a small GABLE, not a
    # lean-to (ridge along its local y, slopes falling to x +-1.82, z 0..2.5):
    # placed flat against the wall it read as a tiny gable whose ridge stuck
    # straight OUT over the window (Troy, 2026-09-08: "the arc sticks in the
    # wrong direction"). Same cure as House E's shed: rz=+pi/2 lays the ridge
    # ALONG the front wall at the wall face, one slope falls outward to an eave
    # on the two posts (HY + 2.1) and the inner slope is bisected off at the
    # wall plane so nothing hangs inside the shop. Ridge 4.85 (under the
    # storey line at 5.0), eave 3.55 = the post tops, 4.9 long over the bay.
    AW_SX, AW_SY, AW_SZ = 1.3, 1.87, 0.62
    aw = use('buildings/HouseRoof_07', 1.25 - 0.46 * AW_SY, HY + 0.1, 3.55 - 0.4 * AW_SZ, math.pi / 2, 'L0',
             sx=AW_SX, sy=AW_SY, sz=AW_SZ)
    import bmesh as _bm_mod
    aw.data = aw.data.copy()
    _bm = _bm_mod.new()
    _bm.from_mesh(aw.data)
    _bm_mod.ops.bisect_plane(_bm, geom=_bm.verts[:] + _bm.edges[:] + _bm.faces[:],
                             plane_co=(-0.12, 0.0, 0.0), plane_no=(1.0, 0.0, 0.0), clear_inner=True)
    _bm.to_mesh(aw.data)
    _bm.free()
    use('buildings/Corner_01', -0.9, HY + 2.1, 0, 0, 'L0', sz=3.55 / 3.70)
    use('buildings/Corner_01', 3.4, HY + 2.1, 0, 0, 'L0', sz=3.55 / 3.70)
    # Wares under the awning
    use('props/Barrel_01', 0.0, HY + 0.85, 0, 0, 'L0')
    use('props/Barrel_02', 0.8, HY + 0.7, 0, 0.7, 'L0')
    use('props/Box_01', 2.4, HY + 0.7, 0, 0.4, 'L0')
    use('props/Box_01', 2.4, HY + 0.7, 0.35, 1.2, 'L0')
    use('props/Box_02', 3.0, HY + 1.3, 0.41, 0.2, 'L0')
    use('props/Bag_01', 1.6, HY + 1.2, 0, 0.3, 'L0')
    use('nature/FlowerPot_02', -0.5, HY + 1.5, 0, 0.4, 'L0')
    # Sign on the wing's street side, lanterns flanking the door, entry steps
    use('props/SignBoard_05', WX1 + 0.12, 4.6, 2.35, math.pi, 'L0')
    use('props/Lantern_01', WX0 + 0.5, WY + 0.6, 0, math.pi, 'L0')
    use('props/Lantern_01', WX1 - 0.5, WY + 0.6, 0, math.pi, 'L0')
    use('nature/FlowerPot_05', HX + 0.6, 2.0, 0, 1.2, 'L0')
    steps(WXC, WY + 0.24, 0, 4.6, 2, 0.2)

    # ---------------- collision ----------------
    T = 0.24
    col_wall(WX1, HY, HX, HY, 0, Z2, T)                 # main front, east of the wing
    col_wall(HX, HY, HX, -HY, 0, Z2, T)                 # east
    col_wall(HX, -HY, -HX, -HY, 0, Z2, T)               # back
    col_wall(-HX, -HY, -HX, WY, 0, Z2, T)               # west (main + wing)
    col_wall(WX0, WY, WXC - 1.05, WY, 0, Z2, T)         # wing front, west of the door
    col_wall(WXC + 1.05, WY, WX1, WY, 0, Z2, T)         # wing front, east of the door
    col(WXC, WY, 4.3 + 1.5, 1.1, T, 2.2)                # arch lintel + wall above
    col_wall(WX1, WY, WX1, HY, 0, Z2, T)                # wing east side
    col(-0.35, -0.6, 0.55, 2.0, 0.45, 0.55)             # counter
    col(-3.6, -0.6, 2.4, 0.5, 0.5, 2.4)                 # vault columns + gate
    col(-3.6, -3.3, 2.4, 0.5, 0.5, 2.4)
    col(-3.62, -1.95, 2.25, 0.1, 1.1, 2.25)
    col(-5.3, -2.2, 0.4, 0.8, 1.2, 0.4)                 # chests
    col(1.9, -HY + 0.3, 1.0, 2.1, 0.3, 1.0)             # back shelves
    col(-1.6, -2.4, 0.5, 0.85, 0.65, 0.45)              # clerk desk
    col(1.4, 2.6, 0.35, 1.35, 0.45, 0.35)               # display table
    col(4.6, 2.85, 0.45, 0.9, 0.5, 0.45)                # barrels + crates
    col(WX0 + 0.55, 5.0, 0.5, 0.3, 1.55, 0.5)           # bench
    col(WX1 - 0.4, 4.4, 1.0, 0.25, 0.9, 1.0)            # notice board
    col(1.25, HY + 1.4, 0.45, 2.0, 0.9, 0.45)           # wares outside
    col(-0.9, HY + 2.1, 1.8, 0.2, 0.2, 1.8)             # awning posts
    col(3.4, HY + 2.1, 1.8, 0.2, 0.2, 1.8)
    for lx in (WX0 + 0.5, WX1 - 0.5):
        col(lx, WY + 0.6, 1.25, 0.28, 0.28, 1.25)
    # Stairs: a rising deck along the treads, then a flat landing to the floor
    ramp(STX, (y_lo + y_hi) / 2, (y_lo - y_hi) / 2, 0.9, -math.pi / 2, 0.28, Z1 + 0.2)
    ramp(STX, y_hi - 0.35, 0.35, 0.9, -math.pi / 2, Z1 + 0.2, Z1 + 0.2)
    # Upper floor as thin standable boxes (stairwell open)
    col(-0.95, 0.0, Z1 + 0.14, 5.3, HY, 0.08)
    col(5.3, -2.5, Z1 + 0.14, 0.95, 1.25, 0.08)
    col(WXC, 5.0, Z1 + 0.14, 2.5, 1.25, 0.08)
    col(4.35, 1.5, Z1 + 0.75, 0.12, 2.25, 0.55)         # rails
    col(-2.0, -2.4, Z1 + 0.6, 0.85, 0.65, 0.45)         # upstairs desk
    col(1.7, -HY + 0.3, Z1 + 1.2, 1.4, 0.3, 1.0)        # upstairs shelves
    col(-3.9, 4.9, Z1 + 0.5, 0.6, 0.6, 0.4)             # wing table
    interior(-HX + 0.2, HX - 0.2, -HY + 0.2, HY - 0.2, 0.0, Z1)
    interior(WX0 + 0.2, WX1 - 0.2, HY - 0.2, WY - 0.2, 0.0, Z1)
    interior(-HX + 0.2, HX - 0.2, -HY + 0.2, HY - 0.2, Z1, Z_RIDGE)
    interior(WX0 + 0.2, WX1 - 0.2, HY - 0.2, WY - 0.2, Z1, W_RIDGE)

    flatten_tiles()
    dissolve_planar()
    decimate_slabs()
    finalize('tidehold_bank', SCRATCH + '/out', S)
    render_shot(SCRATCH + '/bank_ext.png', (14, 26, 12), (-1, 1, 6), w=1500, h=1000)
    render_shot(SCRATCH + '/bank_ext2.png', (-20, 22, 10), (-2, 1, 6), w=1500, h=1000)
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(True)
    render_shot(SCRATCH + '/bank_int.png', (-3.5, 9.5, 3.2), (0.5, -2.5, 1.5), w=1500, h=1000, fov=75)
    for o in list(_GROUPS.get('H1').children):
        o.hide_set(True)
    render_shot(SCRATCH + '/bank_int2.png', (3.0, 5.5, 3.0), (-4.5, -2.5, 1.2), w=1500, h=1000, fov=75)
    for o in list(_GROUPS.get('H2').children) + list(_GROUPS.get('H1').children):
        o.hide_set(False)
except Exception:
    print(traceback.format_exc())
