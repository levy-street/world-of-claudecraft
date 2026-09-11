# Five NON-enterable filler houses for Tidehold. Closed doors, no interiors,
# plank walls (Planks85_08), slate roofs with the kit's closed timber gables.
# Front faces +Y. Each exports to out/tidehold_house_<a..e>.glb at S=1.85.
#
# 2026-09-03 audit round (house_audit/REPORT.md): doors freed from the plinth
# and fitted to their openings (house_e's door was inside a solid wall and the
# real doorway an open hole), corner posts no longer poke through the roofs,
# gable infill is planked before the slate retint, props pulled out of the
# walls and off the roofs, dark interior boxes behind the windows, and the
# lighten() pass (bl_lite.py: hidden-face cull + slab decimation) before
# every export. Prepend HOUSES='ab' to build a subset.
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/b3a5eb48-37dc-4429-b53c-25163d3a9b01/scratchpad/bl'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    exec(open(SCRATCH + '/bl_lite.py').read())
    FLOOR_DEFAULT = 'planks'
    # Light exterior for the filler houses: cream plaster infill between the
    # kit's dark timbers under the slate roofs. The tavern keeps its planks.
    WALL_STYLE = 'plaster'
    try:
        HOUSES
    except NameError:
        HOUSES = 'abcde'
    LOG = []

    def log(*a):
        LOG.append(' '.join(str(x) for x in a))

    M = 2.5
    S = 1.85
    WALL_H = 3.0
    # Kit corner posts are taller than the storeys they stand on (their top is
    # the roof-bearing stub): scale them to the wall top or they stand proud of
    # the eave at all four roof corners (audit C3).
    CORNER_H = {'Corner_01': 3.70, 'Corner_04': 6.624}

    def shell(hx, hy, storeys, front, back, west, east, corner='Corner_01', base=True):
        """Rectangular shell of HouseWall modules. front/back/west/east are lists
        of piece names per module (west-to-east / south-to-north). Returns the
        module xs, ys and the x of every doorway module (HouseWall_08) on the
        front, so door_closed() can be checked against it."""
        xs = [-hx + M / 2 + i * M for i in range(int(round(2 * hx / M)))]
        ys = [-hy + M / 2 + i * M for i in range(int(round(2 * hy / M)))]
        for st in range(storeys):
            z = st * WALL_H
            for x, p in zip(xs, front[st]):
                use('buildings/' + p, x, hy, z, 0, 'L0')
            for x, p in zip(xs, back[st]):
                use('buildings/' + p, x, -hy, z, 0, 'L0')
            for y, p in zip(ys, west[st]):
                use('buildings/' + p, -hx, y, z, math.pi / 2, 'L0')
            for y, p in zip(ys, east[st]):
                use('buildings/' + p, hx, y, z, math.pi / 2, 'L0')
        csz = storeys * WALL_H / CORNER_H[corner]
        for cx, cy in ((-hx, -hy), (-hx, hy), (hx, -hy), (hx, hy)):
            use('buildings/' + corner, cx, cy, 0, 0, 'L0', sz=csz)
        door_xs = [x for x, p in zip(xs, front[0]) if p == 'HouseWall_08']
        if base:
            # The plinth used to stand 1.3 yd high across the door (audit C1):
            # skip the doorway module and sink the rest to a 0.2 kerb.
            for x in xs:
                if any(abs(x - dx) < 0.01 for dx in door_xs):
                    continue
                use('buildings/HouseBase_01', x, hy + 0.16, -0.5, 0, 'L0')
        # A near-black box inside each storey: windows are open holes, so this
        # is what you see through them instead of the far wall's inner planks
        # (and it lets the hidden-face cull drop every inner face).
        dark_box(hx - 0.12, hy - 0.12, 0.05, storeys * WALL_H - 0.05)
        return xs, ys, door_xs

    def roof(piece, z_top, sx=1.0, sy=1.0, sz=1.0, rz=0.0, grp='H2', zmin=3.587):
        """Place a kit roof so its eave (zmin*sz above its origin) meets z_top."""
        return use('buildings/' + piece, 0, 0, z_top - zmin * sz, rz, grp, sx=sx, sy=sy, sz=sz)

    def box_collision(hx, hy, z_eave, z_ridge, ridge_axis='x'):
        col(0, 0, z_eave / 2, hx + 0.05, hy + 0.05, z_eave / 2)
        # Roof volume as a stepped pair of boxes up to the ridge (cheap, solid).
        h = z_ridge - z_eave
        if ridge_axis == 'x':
            col(0, 0, z_eave + h * 0.25, hx + 0.2, hy * 0.66, h * 0.25)
            col(0, 0, z_eave + h * 0.7, hx + 0.2, hy * 0.3, h * 0.2)
        else:
            col(0, 0, z_eave + h * 0.25, hx * 0.66, hy + 0.2, h * 0.25)
            col(0, 0, z_eave + h * 0.7, hx * 0.3, hy + 0.2, h * 0.2)

    def door_closed(x, y, door_xs, rz=0.0):
        # HouseDoor_01 hinge at the west jamb of a HouseWall_08 opening; closed.
        # The leaf (0.974 wide) is stretched 2.7% to span the 1.00 opening so no
        # latch-side slot shows the interior (audit C2). The x is checked
        # against the shell's doorway modules: house_e once had its door on a
        # solid wall (E1).
        assert any(abs(x - dx) < 1e-6 for dx in door_xs), f'door at {x} but doorways at {door_xs}'
        use('buildings/HouseDoor_01', x - 0.51, y - 0.1, 0.0, rz, 'L0', sx=1.027, sz=1.004)

    def build_end(name, shot_eye, shot_target):
        lighten(log)
        finalize(name, SCRATCH + '/out', S)
        try:
            render_shot(SCRATCH + '/shots/' + name + '.png', shot_eye, shot_target, w=900, h=650)
        except SystemError as e:
            log(f'  (no preview in background mode: {e})')   # the GPU draw is unavailable headless; the export is done
        log(f'== {name} exported')

    built = []

    # ---------------- A: the cottage (5 x 5, one storey) ----------------
    if 'a' in HOUSES:
        reset_build()
        xs, ys, dxs = shell(2.5, 2.5, 1,
              front=[['HouseWall_08', 'HouseWall_11']], back=[['HouseWall_02', 'HouseWall_06']],
              west=[['HouseWall_11', 'HouseWall_02']], east=[['HouseWall_02', 'HouseWall_12']])
        door_closed(-1.25, 2.5, dxs)
        roof('HouseRoof_02', WALL_H)
        use('buildings/Chimney_01', 1.6, -1.2, 5.6, 0, 'H2')
        use('nature/FlowerPot_02', 0.6, 2.9, 0, 0.3, 'L0', snap_ground=True)
        use('nature/FlowerPot_05', 1.9, 2.95, 0, 0.0, 'L0', snap_ground=True)  # window box, square to the wall
        use('props/Barrel_01', -3.05, 1.2, 0, 0, 'L0')
        # Ivy_03 was an 11.7-unit draping vine that ran 3.75 past both ends of
        # the house and under the ground (A1): a wall ivy instead.
        use('nature/Ivy_05', 2.72, -0.4, 0, math.pi / 2, 'L0', s=0.8, snap_ground=True)
        use('props/Firewood_01', 2.95, 0.8, 0, math.pi / 2, 'L0')
        steps(-1.25, 2.68, 0, 1.6, 1, 0.2)
        box_collision(2.5, 2.5, 3.0, 6.6)
        build_end('tidehold_house_a', (9, 13, 7), (0, 0, 2.5))
        built.append('a')

    # ---------------- B: the townhouse (7.5 x 5, two storeys) ----------------
    if 'b' in HOUSES:
        reset_build()
        xs, ys, dxs = shell(3.75, 2.5, 2,
              front=[['HouseWall_11', 'HouseWall_08', 'HouseWall_02'], ['HouseWall_12', 'HouseWall_11', 'HouseWall_12']],
              back=[['HouseWall_02', 'HouseWall_06', 'HouseWall_02'], ['HouseWall_11', 'HouseWall_02', 'HouseWall_11']],
              west=[['HouseWall_02', 'HouseWall_11'], ['HouseWall_12', 'HouseWall_02']],
              east=[['HouseWall_11', 'HouseWall_02'], ['HouseWall_02', 'HouseWall_12']], corner='Corner_04')
        door_closed(0.0, 2.5, dxs)
        roof('HouseRoof_03', 2 * WALL_H)
        # The dormer hood (HouseRoof_08) is gone: it shipped terracotta with a
        # dark cavity behind it and 83% of it sat inside the main roof (B1).
        use('buildings/Chimney_01', -2.4, -1.1, 8.3, 0, 'H2')
        use('props/Lantern_01', 1.6, 2.6, 0, math.pi, 'L0')
        use('props/Box_01', -3.2, 3.35, 0, 0.4, 'L0')
        use('props/Barrel_02', -2.5, 3.1, 0, 0.9, 'L0')
        use('nature/FlowerPot_03', 3.1, 2.85, 0, 0.2, 'L0', snap_ground=True)
        use('nature/Ivy_04', -4.0, 0.6, 0, -math.pi / 2, 'L0', s=1.2, snap_ground=True)  # Ivy_01 was 1.8k tris of cards
        steps(0.0, 2.68, 0, 1.6, 1, 0.2)
        box_collision(3.75, 2.5, 6.0, 9.6)
        build_end('tidehold_house_b', (11, 14, 9), (0, 0, 4))
        built.append('b')

    # ---------------- C: the narrow house (5 x 7.5, two storeys, ridge along Y) ----------------
    if 'c' in HOUSES:
        reset_build()
        xs, ys, dxs = shell(2.5, 3.75, 2,
              front=[['HouseWall_08', 'HouseWall_11'], ['HouseWall_12', 'HouseWall_12']],
              back=[['HouseWall_06', 'HouseWall_02'], ['HouseWall_02', 'HouseWall_11']],
              west=[['HouseWall_11', 'HouseWall_02', 'HouseWall_11'], ['HouseWall_02', 'HouseWall_12', 'HouseWall_02']],
              east=[['HouseWall_02', 'HouseWall_11', 'HouseWall_02'], ['HouseWall_12', 'HouseWall_02', 'HouseWall_12']], corner='Corner_04')
        door_closed(-1.25, 3.75, dxs)
        roof('HouseRoof_03', 2 * WALL_H, rz=math.pi / 2)
        use('buildings/Chimney_01', 1.1, -2.9, 8.2, 0, 'H2')
        use('props/SignBoard_01', 1.4, 3.92, 2.4, -math.pi / 2, 'L0')  # grocer's board
        # The stall used to sit 1.24 units INSIDE the front wall (C-1).
        use('props/Market_02', 2.0, 5.0, 0, 0, 'L0', s=0.9)
        use('props/Bag_03', -2.95, 3.0, 0, 0.5, 'L0')
        use('nature/FlowerPot_06', -3.1, 1.4, 0, 0.7, 'L0', snap_ground=True)
        use('nature/Ivy_04', 2.85, -1.6, 0, math.pi / 2, 'L0', snap_ground=True)
        steps(-1.25, 3.93, 0, 1.6, 1, 0.2)
        box_collision(2.5, 3.75, 6.0, 9.6, ridge_axis='y')
        build_end('tidehold_house_c', (10, 15, 9), (0, 0, 4))
        built.append('c')

    # ---------------- D: the square house with a porch (7.5 x 7.5, one storey, big roof) ----------------
    if 'd' in HOUSES:
        reset_build()
        xs, ys, dxs = shell(3.75, 3.75, 1,
              front=[['HouseWall_11', 'HouseWall_08', 'HouseWall_11']], back=[['HouseWall_02', 'HouseWall_12', 'HouseWall_02']],
              west=[['HouseWall_02', 'HouseWall_11', 'HouseWall_02']], east=[['HouseWall_11', 'HouseWall_02', 'HouseWall_11']])
        door_closed(0.0, 3.75, dxs)
        roof('HouseRoof_04', WALL_H)
        use('buildings/Chimney_01', 2.2, -1.6, 6.4, 0, 'H2')
        # Porch: the kit's open terrace roof, pushed half into the facade. sz
        # 0.85 lifts its tie beam clear of the door head (D1).
        use('buildings/TerraceRoof_01', 0, 3.75 + 2.0, 0, 0, 'L0', sx=0.8, sy=0.62, sz=0.85)
        use('props/Furniture_14', -1.95, 4.6, 0, 0, 'L0', s=0.8)  # bench clear of the door (D2)
        use('props/Barrel_01', 2.4, 4.4, 0, 0, 'L0')
        use('nature/FlowerPot_01', -3.2, 4.5, 0, 0.2, 'L0', snap_ground=True)
        use('nature/FlowerPot_04', 3.2, 4.6, 0, 1.4, 'L0', snap_ground=True)
        # Fence runs from the porch posts back to the house corners instead of
        # two loose bits standing in front of the facade (D6).
        use('props/Fence_01', -3.15, 5.0, 0, math.pi / 2, 'L0')
        use('props/Fence_01', 3.15, 5.0, 0, math.pi / 2, 'L0')
        use('nature/Ivy_05', -4.0, -1.0, 0, -math.pi / 2, 'L0', s=0.45, snap_ground=True)  # was through the roof (D3)
        steps(0.0, 3.93, 0, 1.8, 1, 0.2)
        box_collision(3.75, 3.75, 3.0, 7.8)
        col(0, 5.75, 1.9, 2.6, 2.0, 1.9)  # porch roof + posts as one soft block
        build_end('tidehold_house_d', (12, 16, 8), (0, 1, 3))
        built.append('d')

    # ---------------- E: the long house (10 x 5, two storeys, lean-to) ----------------
    if 'e' in HOUSES:
        reset_build()
        xs, ys, dxs = shell(5.0, 2.5, 2,
              front=[['HouseWall_11', 'HouseWall_08', 'HouseWall_02', 'HouseWall_11'], ['HouseWall_12', 'HouseWall_02', 'HouseWall_12', 'HouseWall_02']],
              back=[['HouseWall_02', 'HouseWall_06', 'HouseWall_02', 'HouseWall_06'], ['HouseWall_11', 'HouseWall_02', 'HouseWall_11', 'HouseWall_02']],
              west=[['HouseWall_02', 'HouseWall_11'], ['HouseWall_12', 'HouseWall_02']],
              east=[['HouseWall_11', 'HouseWall_02'], ['HouseWall_02', 'HouseWall_12']], corner='Corner_04')
        # The doorway module is at x -1.25; the door and steps used to sit at
        # -2.5, inside the solid wall, leaving the real opening a hole (E1).
        door_closed(-1.25, 2.5, dxs)
        roof('HouseRoof_03', 2 * WALL_H, sx=1.25)
        use('buildings/Chimney_01', 3.2, -1.0, 8.3, 0, 'H2')
        use('buildings/Chimney_01', -3.6, -1.0, 8.3, 0, 'H2')
        # Lean-to shed against the east wall (E2). HouseRoof_07 is a small
        # GABLE (ridge along its local y, x +-1.82, y -1.77..0.85, z 0..2.5):
        # pointed at the house its upper slope drove through the second-storey
        # window and its inner end sat inside the wall. Now the ridge lies
        # ALONG the wall at the wall face (x 5.0), one slope falls outward to
        # an eave at x 7.37 / z 2.2 (4 yd of headroom), the inner slope is
        # inside the house and culled, and the ridge tops out at 3.65, under
        # the upper window sills (3.9). Two posts under the outer eave corners.
        use('buildings/HouseRoof_07', 5.0, 0.645, 2.0, 0, 'L0', sx=1.3, sy=1.4, sz=0.7)
        for py in (-1.55, 1.55):
            use('buildings/Corner_01', 7.05, py, 0, 0, 'L0', sz=2.35 / CORNER_H['Corner_01'])
        use('props/Box_01', 6.0, 0.6, 0, 0.3, 'L0')
        use('props/Box_01', 6.0, 0.55, 0.35, 1.1, 'L0')
        use('props/Barrel_02', 6.3, -0.7, 0, 0, 'L0')  # Barrel_03 is a 0.09-unit thimble (E5)
        use('props/Firewood_01', 5.7, -0.2, 0, 0, 'L0')
        use('props/Lantern_01', -0.1, 2.6, 0, math.pi, 'L0')  # beside the real door
        use('nature/FlowerPot_07', 2.2, 3.05, 0, 0.0, 'L0', snap_ground=True)
        use('props/NoticeBoard_01', 3.6, 3.0, 0, 0, 'L0', s=0.85)
        use('nature/Ivy_06', -5.35, -0.8, 0, -math.pi / 2, 'L0', snap_ground=True)
        steps(-1.25, 2.68, 0, 1.6, 1, 0.2)
        box_collision(5.0, 2.5, 6.0, 9.6)
        col(6.2, 0.0, 1.5, 1.3, 1.6, 1.5)  # lean-to clutter block
        build_end('tidehold_house_e', (14, 16, 9), (0, 0, 4))
        built.append('e')

    print('\n'.join(LOG))
    print('HOUSES DONE', built)
except Exception:
    print(traceback.format_exc())
