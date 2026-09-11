# The Glass Market hall, open-air pavilion: central gable roof on posts with
# two terrace-roof wings, stalls + goods beneath. Open on all sides. S=1.5.
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/cbf8046f-7d43-48f1-b70b-3b602edd9a6d/scratchpad'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    reset_build()
    M = 2.5
    S = 1.7

    # Cobble plinth 6x4 modules (15 x 10)
    for ix in range(8):
        for iy in range(4):
            use('environment/Tile_01', -10 + M / 2 + ix * M, -5 + M / 2 + iy * M, 0.0, 0, 'L0')
    # Central hall posts (10 x 10 span), wood posts at the roof rim
    post_tpl = load_template('buildings/Corner_02')
    post_sz = 3.3 / max(0.001, post_tpl.dimensions.z)  # full posts to the eave
    for px, py in ((-4.4, -4.4), (-4.4, 4.4), (4.4, -4.4), (4.4, 4.4)):
        use('buildings/Corner_02', px, py, 0, 0, 'L0', sz=post_sz)
        col(px, py, 1.65, 0.3, 0.3, 1.65)
    # Central gable roof
    roof = use('buildings/HouseRoof_06', 0, 0, -0.15, 0, 'H2')
    retint_roof([roof])
    # Wings: terrace roofs (self-standing with posts) at +-X
    w1 = use('buildings/TerraceRoof_01', -7.1, 0, 0, math.pi / 2, 'H2')
    w2 = use('buildings/TerraceRoof_01', 7.1, 0, 0, -math.pi / 2, 'H2')
    retint_roof([w1, w2])
    # Wing posts collide (terrace roofs have their own posts at ~+-2.9,+-3.1)
    for sx_ in (-1, 1):
        for ox, oy in ((-2.6, -2.9), (-2.6, 2.9), (2.6, -2.9), (2.6, 2.9)):
            col(sx_ * 7.1 + ox, oy, 1.6, 0.25, 0.25, 1.6)

    # ---------------- stalls + goods ----------------
    use('props/Market_03', -2.6, 2.4, 0.17, math.pi, 'L0')  # blue, faces south
    use('props/Market_04', 2.6, 2.4, 0.17, math.pi, 'L0')  # purple
    use('props/Market_01', -2.6, -2.4, 0.17, 0, 'L0')  # red, faces north
    use('props/Market_02', 2.6, -2.4, 0.17, 0, 'L0')
    col(-2.6, 2.6, 0.8, 1.65, 0.75, 0.8)
    col(2.6, 2.6, 0.8, 1.65, 0.75, 0.8)
    col(-2.6, -2.6, 0.8, 1.65, 0.75, 0.8)
    col(2.6, -2.6, 0.8, 1.65, 0.75, 0.8)
    # Stall goods
    use('props/Food_03', -2.9, 2.15, 1.0, 0.3, 'L0')
    use('props/Food_07', -2.2, 2.2, 1.0, 1.2, 'L0')
    use('props/Food_11', 2.3, 2.2, 1.0, 0.8, 'L0')
    use('props/Potion_03', 2.85, 2.15, 1.05, 0, 'L0')
    use('props/Food_15', -2.5, -2.2, 1.0, 2.1, 'L0')
    use('props/Plate_03', 2.4, -2.2, 1.0, 0.5, 'L0')
    # Center aisle: crates, sacks, barrels
    use('props/Box_02', -0.5, 0.3, 0.575, 0.4, 'L0')
    use('props/Box_01', -0.4, 0.35, 0.98, 1.1, 'L0')
    use('props/Bag_01', 0.6, 0.5, 0.17, 0, 'L0')
    use('props/Bag_03', 0.9, -0.3, 0.17, 0.7, 'L0')
    use('props/Barrel_01', -1.4, -0.6, 0.17, 0, 'L0')
    col(-1.4, -0.6, 0.55, 0.4, 0.4, 0.42)
    col(-0.4, 0.4, 0.55, 0.75, 0.75, 0.55)
    # Wing goods (west: produce, east: wares)
    use('props/Box_01', -6.7, 1.4, 0.17, 0.3, 'L0')
    use('props/Food_18', -6.7, 1.4, 0.6, 0.9, 'L0')
    use('props/Bag_04', -7.4, -1.2, 0.17, 0, 'L0')
    use('props/Barrel_02', -6.2, -1.8, 0.17, 0.5, 'L0')
    col(-6.2, -1.8, 0.55, 0.4, 0.4, 0.42)
    use('props/Firewood_01', 6.6, -1.4, 0.17, 1.2, 'L0')
    col(6.6, -1.4, 0.42, 0.72, 0.42, 0.32)
    use('props/Box_02', 7.2, 1.5, 0.575, 2.2, 'L0')
    use('props/Helmet_02', 7.2, 1.5, 1.06, 0.4, 'L0')
    use('props/Shield_03', 6.4, 2.0, 0.17, 0.9, 'L0')
    col(-6.7, 1.4, 0.4, 0.5, 0.5, 0.4)
    col(7.2, 1.5, 0.55, 0.5, 0.5, 0.55)
    # Signage + notice board at the north entrance
    use('props/NoticeBoard_01', -5.6, 4.6, 0.17, 0.2, 'L0')
    col(-5.6, 4.6, 1.1, 0.95, 0.3, 1.1)
    use('props/Pointer_01', 5.7, 4.5, 0.17, -0.4, 'L0')
    col(5.7, 4.5, 1.0, 0.35, 0.35, 1.0)
    # Hanging flags on the central roof edge
    use('props/Flag_03', -1.8, 4.62, 3.6, 0, 'H2')
    use('props/Flag_05', 0.0, 4.62, 3.6, 0, 'H2')
    use('props/Flag_03', 1.8, 4.62, 3.6, 0, 'H2')
    use('props/Flag_05', -0.9, -4.62, 3.6, math.pi, 'H2')
    use('props/Flag_03', 0.9, -4.62, 3.6, math.pi, 'H2')

    # Interior: under central roof + wings (roof hides while browsing)
    interior(-8.6, 8.6, -5.2, 5.2, 0.0, 3.6)

    finalize('tidehold_market', SCRATCH + '/out', S)
    render_shot(SCRATCH + '/market_ext.png', (16, 22, 11), (0, 0, 3.5), w=1500, h=1000)
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(True)
    render_shot(SCRATCH + '/market_int.png', (0.5, 7.8, 3.2), (-1.5, -6.0, 0.8), w=1500, h=1000, fov=70)
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(False)
except Exception:
    print(traceback.format_exc())
