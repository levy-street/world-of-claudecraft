# The Tidehold town kit v2: WoW-style houses, shops, taverns, the market, the
# smithy and the church, built parametrically with bl_town_lib.py.
#
#   Headless build + export (glTF export over the MCP bridge crashes 5.1):
#     TOWN_EXPORT=1 [PIECES=house_a,...] /Applications/Blender.app/Contents/MacOS/Blender -b \
#       --python scripts/assets/blender_tidehold/bl_town.py
#   Live in the GUI (Blender open with the MCP addon serving :9876):
#     python3 ~/.claude/tools/blender_bridge.py run scripts/assets/blender_tidehold/town_gui.py
#     (town_gui.py sets ROOT/GUI/PIECES and execs this file)
#
# Output: <OUT>/tidehold_<name>.glb + .collision.json (+ .parts.glb, the
# Studio "Edit pieces" twin). Model yards, front facing +Y (-Z in the GLB),
# origin on the ground line at the footprint centre.
import traceback
LOG = []
try:
    import os
    import sys
    if 'ROOT' not in globals():
        _argv = sys.argv
        _py = _argv[_argv.index('--python') + 1] if '--python' in _argv else ''
        ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(_py)), '..', '..', '..'))
    GUI = bool(globals().get('GUI', False))
    PREVIEW_VCOL = GUI
    exec(open(ROOT + '/scripts/assets/blender_tidehold/bl_town_lib.py').read())
    exec(open(ROOT + '/scripts/assets/blender_tidehold/bl_town_lod.py').read())      # the 200-yd twins
    PREVIEW_VCOL = GUI
    OUT = os.environ.get('TOWN_OUT') or (ROOT + '/tmp/asset_src/tidehold_town')
    os.makedirs(OUT, exist_ok=True)
    DO_EXPORT = bool(os.environ.get('TOWN_EXPORT')) and not GUI
    WANT = [w for w in (globals().get('PIECES') or os.environ.get('PIECES') or 'house_a').split(',') if w]
    FL = 0.45          # ground-floor top above the ground line

    def log(*a):
        LOG.append(' '.join(str(x) for x in a))

    # =========================================================================
    #  THE HOUSE GRAMMAR
    # =========================================================================
    # Sides: 'n' front (+y), 's' back, 'e' (+x), 'w' (-x). A wall runs so its
    # outward normal is on its right: n (x1,y1)->(x0,y1), w (x0,y1)->(x0,y0),
    # s (x0,y0)->(x1,y0), e (x1,y0)->(x1,y1).
    def wall_ends(side, r):
        x0, x1, y0, y1 = r
        return {'n': ((x1, y1), (x0, y1)), 'w': ((x0, y1), (x0, y0)),
                's': ((x0, y0), (x1, y0)), 'e': ((x1, y0), (x1, y1))}[side]

    def along(side, r, coord):
        """World x (n/s walls) or y (e/w walls) -> distance s along the wall."""
        x0, x1, y0, y1 = r
        return {'n': x1 - coord, 's': coord - x0, 'e': coord - y0, 'w': y1 - coord}[side]

    def outward(side):
        return {'n': (0, 1), 's': (0, -1), 'e': (1, 0), 'w': (-1, 0)}[side]

    def expand(r, sides, d):
        x0, x1, y0, y1 = r
        return (x0 - (d if 'w' in sides else 0), x1 + (d if 'e' in sides else 0),
                y0 - (d if 's' in sides else 0), y1 + (d if 'n' in sides else 0))

    def spread(L, n, avoid=(), w=1.2, margin=1.2):
        """n window centres spread along a wall of length L, clear of
        `avoid` = [(s0, s1)] (the door) and the corners."""
        if n <= 0:
            return []
        out = []
        for i in range(n):
            s = margin + (L - 2 * margin) * ((i + 0.5) / n)
            for (a, b) in avoid:
                if a - w / 2 - 0.4 < s < b + w / 2 + 0.4:
                    s = b + w / 2 + 0.5 if s > (a + b) / 2 else a - w / 2 - 0.5
            if margin * 0.6 < s < L - margin * 0.6:
                out.append(s)
        return out

    # ---- wall planning ---------------------------------------------------------
    # Everything that hangs on a wall face (openings with their frames,
    # shutters and surrounds; lanterns; the jetty brackets of the storey
    # above) is planned against everything else on that face as along-wall
    # SPANS, so nothing is ever dressed through something else: a window
    # never lands behind a chimney breast or inside a turret, a shutter never
    # folds over the quoins or a door surround, a bracket never hangs across
    # a door's arch (SPACEY, 2026-09-26: "a lot of them are clipping").
    QUOIN_ZONE = 1.15          # quoins(size=0.9): the long block reaches 1.125 - proud
    POST_ZONE = 0.4            # a framed wall's corner post, and a hair

    def clear_of(a, b, spans):
        return all(b <= s0 or a >= s1 for (s0, s1) in spans)

    def world_spans(side, rect, obst):
        """Obstacles given in WORLD coordinates -> along-wall spans on `rect`.
        obst items: ('band', side, c0, c1) a stretch of one wall (x on n/s,
        y on e/w), or ('disc', cx, cy, R) a round body (a turret)."""
        x0, x1, y0, y1 = rect
        out = []
        for ob in obst:
            if ob[0] == 'band':
                if ob[1] != side:
                    continue
                a, b = sorted((along(side, rect, ob[2]), along(side, rect, ob[3])))
            else:
                cx, cy, R = ob[1:]
                line, c_on, c_off = ((y1 if side == 'n' else y0), cx, cy) if side in 'ns' else \
                    ((x1 if side == 'e' else x0), cy, cx)
                d = abs(line - c_off)
                if d >= R:
                    continue
                hh = math.sqrt(R * R - d * d) + 0.15
                a, b = sorted((along(side, rect, c_on - hh), along(side, rect, c_on + hh)))
            out.append((a - 0.05, b + 0.05))
        return out

    def place_windows(centres, ww, L, spans, corner):
        """Keep each window centre clear of the spans (its frame included);
        slide a clashing one to the nearest clear spot, or drop it."""
        half = ww / 2 + FW + 0.06
        lo, hi = corner + half, L - corner - half
        taken = list(spans)
        out = []
        for c in centres:
            ok = lo <= c <= hi and clear_of(c - half, c + half, taken)
            if not ok:
                cands = [lo, hi]
                for (s0, s1) in taken:
                    cands += [s0 - half - 0.01, s1 + half + 0.01]
                cands = [x for x in cands if lo <= x <= hi and clear_of(x - half, x + half, taken)]
                if not cands:
                    log(f'  window at {c:.2f} dropped (no room)')
                    continue
                c2 = min(cands, key=lambda x: abs(x - c))
                if abs(c2 - c) > 2.5:
                    log(f'  window at {c:.2f} dropped (nearest room {c2:.2f})')
                    continue
                c = c2
            out.append(c)
            taken.append((c - half, c + half))
        return out

    def lantern_spot(o_door, L, spans, pref=1):
        """An along-wall spot for a door's wall lantern, beside the surround,
        on the preferred side if it is clear there."""
        reach, _ = door_surround_reach(o_door)
        for sgn in (pref, -pref):
            s = o_door['s'] + sgn * (reach + 0.45)
            if 0.0 < s - 0.3 and s + 0.3 < L and clear_of(s - 0.3, s + 0.3, spans):
                return s
        return None

    def house(spec):
        W, D = spec['W'], spec['D']
        base = (-W / 2, W / 2, -D / 2, D / 2)
        shell = part('shell')
        upper = part('upper', grp='H1')
        plinth(shell, base[0] - 0.05, base[1] + 0.05, base[2] - 0.05, base[3] + 0.05, FL,
               band=0.42 if spec.get('enterable') else 0.55)        # inside the 0.45 wall of a walked-in room
        rect = base
        z = FL
        top_rect = rect
        door = spec.get('door', {})
        door_side = door.get('side', 'n')
        door_o = None
        lantern_s = None
        storey_z = []
        # obstacles on the wall faces, in world coordinates
        obst = []
        for chm in spec.get('chimneys', []):
            if chm.get('kind') == 'breast':
                cw = chm.get('w', 2.1)
                obst.append(('band', chm['side'], chm['at'] - cw / 2 - 0.1, chm['at'] + cw / 2 + 0.1))
        tu = spec.get('turret')
        if tu:
            r = tu.get('r', 1.5)
            tcx = (base[1] if 'e' in tu['corner'] else base[0]) + (r * 0.35) * (1 if 'e' in tu['corner'] else -1)
            tcy = (base[3] if 'n' in tu['corner'] else base[2]) + (r * 0.35) * (1 if 'n' in tu['corner'] else -1)
            obst.append(('disc', tcx, tcy, r + 0.45))
        sg = spec.get('sign')
        if sg:
            obst.append(('band', sg['side'], sg['at'] - 0.35, sg['at'] + 0.35))
        below = {}                 # the storey below's dressed spans per side (for the jetty brackets)
        for si, st in enumerate(spec['storeys']):
            P = shell if si == 0 else upper
            h = st['h']
            jet = st.get('jetty', '')
            jo = st.get('jo', 0.65)
            if jet:
                jetty(P, rect[0], rect[1], rect[2], rect[3], z, jo, sides=jet, avoid=below)
                rect = expand(rect, jet, jo)
            z0, z1 = z, z + h
            storey_z.append((z0, z1, rect))
            style = st.get('style', 'stone')
            framed = style == 'plaster'
            wmat = {'stone': M_STONE, 'plaster': M_PLASTER, 'teal': M_TEAL, 'blue': M_BLUE}[style]
            wins = st.get('win', {})
            corner = QUOIN_ZONE if style == 'stone' else POST_ZONE
            below = {}
            for side in 'nwse':
                (ax, ay), (bx, by) = wall_ends(side, rect)
                L = math.hypot(bx - ax, by - ay)
                ops = []
                spans = world_spans(side, rect, obst)
                if si == 0 and side == door_side:
                    ds = along(side, rect, door.get('at', 0.0))
                    dw = door.get('w', 1.8)
                    # the surround stays clear of the corner quoins
                    reach0 = dw / 2 + DOOR_RING * 1.4
                    lo_, hi_ = corner + reach0 + 0.1, L - corner - reach0 - 0.1
                    if not lo_ <= ds <= hi_:
                        log(f'  door slid {min(max(ds, lo_), hi_) - ds:+.2f} clear of the quoins')
                        ds = min(max(ds, lo_), hi_)
                    o_d = dict(s=ds, w=dw, z0=z0, z1=z0 + door.get('h', 2.35), arch=True, kind='door')
                    # the keystone stays clear of the storey-head course
                    _, top = door_surround_reach(o_d)
                    if top > z1 - 0.3:
                        o_d['z1'] -= top - (z1 - 0.3)
                    door_o = o_d
                    ops.append(o_d)
                    reach, _ = door_surround_reach(o_d)
                    spans.append((ds - reach - 0.05, ds + reach + 0.05))
                    if door.get('lantern', 1.4):
                        pref = 1 if door.get('lantern', 1.4) < 0 else -1     # world +x is -s on the n wall
                        if side in 'se':
                            pref = -pref
                        lantern_s = lantern_spot(o_d, L, spans + [(0, corner), (L - corner, L)], pref)
                        if lantern_s is not None:
                            spans.append((lantern_s - 0.35, lantern_s + 0.35))
                nwin = wins.get(side, 0)
                if isinstance(nwin, (list, tuple)):
                    centres = [along(side, rect, c) for c in nwin]
                else:
                    centres = spread(L, nwin, [(s0, s1) for (s0, s1) in spans])
                ww = st.get('ww', 1.2 if si == 0 else 1.1)
                # a half-timbered wall takes square-headed windows: an arch
                # between two straight posts reads as clipped
                arched = st.get('arch', si == 0) and not framed
                centres = place_windows(sorted(centres), ww, L, spans, corner)
                for c in centres:
                    zw0 = z0 + (1.2 if si == 0 else 0.95)
                    zw1 = zw0 + (1.25 if arched else 1.7)
                    ops.append(dict(s=c, w=ww, z0=zw0, z1=zw1, arch=arched, kind='window'))
                # a plain opening its builder fills (the bank's vault doorway)
                for eo in spec.get('extra_ops', ()):
                    if eo['storey'] == si and eo['side'] == side:
                        ops.append(dict(s=along(side, rect, eo['at']), w=eo['w'], z0=eo['z0'], z1=eo['z1'], arch=False,
                                        kind='opening'))
                # an ENTERABLE ground storey (the shops) gets its inner plaster
                # face and an open door; every other storey is a closed shell
                inside = si == 0 and spec.get('enterable')
                L, u, n = wall(P, ax, ay, bx, by, z0 - 0.02, z1, wmat, ops, t=0.45,
                               inner=bool(inside), inner_mat=M_PLASTER if inside else None)
                A = Vector((ax, ay, 0))
                if framed:
                    frame_wall(P, ax, ay, bx, by, z0, z1, ops)
                dressed = list(spans)
                if si == 0:
                    # spans kept free for things hung on this wall later (a
                    # shop's awning): the jetty above puts no bracket there
                    for (asd, xa, xb) in spec.get('awning_spans', ()):
                        if asd == side:
                            sa, sb = along(side, rect, xa), along(side, rect, xb)
                            dressed.append((min(sa, sb) - 0.3, max(sa, sb) + 0.3))
                for o in ops:
                    if o['kind'] == 'opening':
                        continue
                    if o['kind'] == 'door':
                        if inside:          # open, the leaves folded back on the inner wall face
                            door_leaf(P, A, u, n, o, 0.45, cell=door.get('cell', 'door_oak'), open_=True)
                        else:
                            door_leaf(P, A, u, n, o, 0.22, cell=door.get('cell', 'door_oak'))    # in the 0.3 reveal
                        door_surround(P, A, u, n, o)
                        continue
                    lit = RNG.random() < st.get('lit', 0.7)
                    window_glass(P, A, u, n, o, 0.28, lit=lit)
                    sh = st.get('shutters') if not framed else None
                    if sh:
                        a, b = shutter_span(o)
                        others = [frame_span(q) for q in ops if q is not o and q['kind'] == 'window']
                        if not (a > corner and b < L - corner and clear_of(a, b, spans + others)) \
                                or RNG.random() > 0.7:
                            sh = None
                    window_frame(P, A, u, n, o, shutters=sh, box=(st.get('boxes', False) and side == 'n'),
                                 sill=True, framed=framed)
                    dressed.append(shutter_span(o) if sh else frame_span(o))
                below[side] = dressed
            if style == 'stone':
                qdepth = 0.42 if (si == 0 and spec.get('enterable')) else None
                for (cx, cy, sx, sy) in ((rect[1], rect[3], 1, 1), (rect[0], rect[3], -1, 1),
                                         (rect[0], rect[2], -1, -1), (rect[1], rect[2], 1, -1)):
                    quoins(P, cx, cy, z0, z1, sx, sy, depth=qdepth)
            # a dressed course at a stone storey's head (a timber storey's
            # frame_wall head plate already is its course)
            if not framed:
                course_band(P, rect, z1 - 0.1)
            # the dark core behind the glass (no floor face: it would share the
            # jetty soffit's plane); an enterable storey has its room instead
            if not (si == 0 and spec.get('enterable')):
                with env_off():          # inside the walls: never part of the LOD twin
                    cuboid(P, ((rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2, (z0 + z1) / 2),
                           (rect[1] - rect[0] - 0.9, rect[3] - rect[2] - 0.9, h), M_DARK, tint=(1, 1, 1),
                           faces={'-x', '+x', '-y', '+y', '+z'})
            z = z1
            top_rect = rect
        EAVE = z
        for Pp in (shell, upper):
            if TEX_SET == 'v1':       # v2: the baked smart mask carries grime + eave occlusion
                ground_darken(Pp)
                eave_shadow(Pp, EAVE)
        # ---- roof --------------------------------------------------------
        R = spec['roof']
        roofp = part('roof', grp='H2')
        tx0, tx1, ty0, ty1 = top_rect
        axis = R.get('axis', 'x')
        length = (tx1 - tx0) if axis == 'x' else (ty1 - ty0)
        span = (ty1 - ty0) if axis == 'x' else (tx1 - tx0)
        gm = {'plaster': M_PLASTER, 'teal': M_TEAL, 'blue': M_BLUE, 'stone': M_STONE}[R.get('gable', 'plaster')]
        z_ridge = gable_roof(roofp, (tx0 + tx1) / 2, (ty0 + ty1) / 2, length, span, EAVE, R['rise'], axis=axis,
                             eave_over=R.get('eave_over', 0.95), gable_over=R.get('gable_over', 0.75),
                             flare=R.get('flare', 0.38), sag=R.get('sag', 0.3), rows=R.get('rows', 11),
                             gable_mat=gm, gable_frame=(gm == M_PLASTER), gable_window=R.get('gable_window'),
                             finial_ends=R.get('finials', (-1, 1)))
        # cross gables: a gable toward the street over part of the front
        for cg in R.get('cross', []):
            cx = cg['x']
            w = cg['w']
            side = cg.get('side', 'n')
            yb = ty1 if side == 'n' else ty0
            depth = cg.get('depth', span / 2 + 0.4)
            cy = yb - (depth / 2 if side == 'n' else -depth / 2)
            front = 1 if side == 'n' else -1
            gable_roof(roofp, cx, cy, depth, w, EAVE, cg['rise'], axis='y', eave_over=0.7, gable_over=0.55,
                       flare=0.36, sag=0.18, rows=9, thick=0.27, gable_mat=gm, gable_frame=(gm == M_PLASTER),
                       closed_ends=(front,), finial_ends=(front,), gable_window=cg.get('window'))
        for dm in R.get('dormers', []):
            dp = part('dormer', grp='H2')
            side = dm.get('side', 'n')
            face = 1 if side == 'n' else -1
            yb = ty1 if side == 'n' else ty0
            dormer(dp, dm['x'], yb - face * (dm.get('in_', dm.get('in', 1.9))), EAVE + dm.get('z', 0.95), dm.get('w', 2.4), 3.0, face,
                   wall_h=dm.get('h', 1.9), rise=dm.get('rise', 1.35))
        for chm in spec.get('chimneys', []):
            cp = part('chimney', grp='H2')
            if chm.get('kind') == 'breast':
                side = chm['side']
                (ax, ay), (bx, by) = wall_ends(side, base)
                if side in 'ns':
                    cxw, cyw = chm['at'], ay
                else:
                    cxw, cyw = ax, chm['at']
                chimney_breast(cp, cxw, cyw, outward(side), chm.get('w', 2.1), EAVE, z_ridge + 0.4)
                o = outward(side)
                col_box(cxw + o[0] * 0.47, cyw + o[1] * 0.47, (z_ridge + 0.4) / 2,
                        0.5 if o[0] else chm.get('w', 2.1) / 2, chm.get('w', 2.1) / 2 if o[0] else 0.5,
                        (z_ridge + 0.4) / 2)
            else:
                chimney(cp, chm['x'], chm['y'], EAVE - 0.5, z_ridge + chm.get('over', 0.6), w=1.05, d=1.0)
        # ---- turret --------------------------------------------------------
        tu = spec.get('turret')
        if tu:
            tp = part('turret')
            cxs = {'ne': (base[1], base[3]), 'nw': (base[0], base[3]), 'se': (base[1], base[2]), 'sw': (base[0], base[2])}
            cx, cy = cxs[tu['corner']]
            r = tu.get('r', 1.5)
            cx += (r * 0.35) * (1 if 'e' in tu['corner'] else -1)
            cy += (r * 0.35) * (1 if 'n' in tu['corner'] else -1)
            face = math.atan2((1 if 'n' in tu['corner'] else -1), (1 if 'e' in tu['corner'] else -1))
            turret(tp, cx, cy, FL, tu.get('top', EAVE + 1.6), r, segs=10, stone_h=tu.get('stone_h'),
                   cone_rise=tu.get('cone'), face=face, mat_upper=M_PLASTER)
            for rot in (0.0, math.pi / 4):
                col_box(cx, cy, tu.get('top', EAVE + 1.6) / 2, r * 0.95, r * 0.95, tu.get('top', EAVE + 1.6) / 2, ry=rot)
        # ---- entry ---------------------------------------------------------
        ent = part('entry')
        if door_o is not None:
            (ax, ay), (bx, by) = wall_ends(door_side, base)
            o = outward(door_side)
            dx = door.get('at', 0.0)
            px, py = (dx, ay) if door_side in 'ns' else (ax, dx)
            po_ = spec.get('porch')
            if po_ and po_.get('side', 'n') == door_side:
                sd = po_['depth']
                steps(ent, px + o[0] * sd, py + o[1] * sd, o, door.get('w', 1.8) + 0.6, FL, n_steps=2)
            else:
                steps(ent, px + o[0] * 0.1, py + o[1] * 0.1, o, door.get('w', 1.8), FL, n_steps=2)
            jettied_front = any(door_side in st.get('jetty', '') for st in spec['storeys'][1:2])
            if door.get('hood') and not jettied_front:
                door_hood(ent, px, py, o, door.get('w', 1.8) + 1.6, FL + door.get('h', 2.35) + 1.25,
                          depth=1.35, rise=1.15)
            if lantern_s is not None:
                # planned with the wall: clear of the surround, shutters, quoins
                L_, u_, n_ = _wall_frame(ax, ay, bx, by)
                lp = Vector((ax, ay, 0)) + u_ * lantern_s + n_ * 0.05
                wall_lantern(ent, lp.x, lp.y, FL + 2.7, o)
        sg = spec.get('sign')
        if sg:
            o = outward(sg['side'])
            (ax, ay), (bx, by) = wall_ends(sg['side'], base)
            px, py = (sg['at'], ay) if sg['side'] in 'ns' else (ax, sg['at'])
            dinfo = None
            if door_o is not None and sg['side'] == door_side:
                (dax, day), (dbx, dby) = wall_ends(door_side, base)
                dL = math.hypot(dbx - dax, dby - day)
                dcx = dax + (dbx - dax) / dL * door_o['s']
                dcy = day + (dby - day) / dL * door_o['s']
                dinfo = (dcx, dcy, door_o['w'], door_o['z1'] + door_o['w'] / 2, FL)
            # placed last (place_signs), clear of everything, beside the door
            hanging_sign(ent, px, py, sg.get('z', FL + 3.6), o, sg['cell'], size=sg.get('size', 1.3), door=dinfo,
                         only_side=sg.get('door_side'))
        # ---- porch / lean-to ---------------------------------------------------
        po = spec.get('porch')
        if po:
            pp = part('porch')
            side = po.get('side', 'n')
            (ax, ay), (bx, by) = wall_ends(side, base)
            dpt = po['depth']
            w = po['w']
            o = outward(side)
            zb = po.get('z', FL + 3.2)
            cx = po.get('at', 0.0)
            yw = ay
            # posts + brackets
            for sgn in (-1, 1):
                px_ = cx + sgn * (w / 2 - 0.25)
                py_ = yw + o[1] * (dpt - 0.3)
                lathe(pp, [(0.32, -0.6), (0.3, 0.2), (0.2, 0.3), (0.2, zb - 0.4), (0.26, zb - 0.25), (0.22, zb)],
                      (px_, py_, 0.0), segs=8, mat=M_TIMBER, smooth=False)
                col_box(px_, py_, zb / 2, 0.3, 0.3, zb / 2)
                beam(pp, (px_, py_, zb - 0.9), (px_, yw + o[1] * 0.1, zb - 0.2), 0.2, 0.2)
            beam(pp, (cx - w / 2, yw + o[1] * (dpt - 0.3), zb), (cx + w / 2, yw + o[1] * (dpt - 0.3), zb), 0.3, 0.34)
            # floorboards, a step up from the path
            cuboid(pp, (cx, yw + o[1] * dpt / 2, FL / 2 - 0.3), (w, dpt, FL + 0.6), M_FLOOR, faces={'+z', '-x', '+x', '+y', '-y'})
            col_ramp(cx, yw + o[1] * dpt / 2, w / 2, dpt / 2, FL, FL)
            gable_roof(pp, cx, yw, w, dpt * 2, zb, po.get('rise', 1.4), axis='x',
                       eave_over=0.45, gable_over=0.3, flare=0.3, sag=0.08, rows=5, thick=0.2,
                       sides=(o[1],), closed_ends=(), finial_ends=(), cap=False)
        lt = spec.get('leanto')
        if lt:
            lp = part('leanto')
            side = lt.get('side', 'e')
            o = outward(side)
            (ax, ay), (bx, by) = wall_ends(side, base)
            dpt = lt['depth']
            ln = lt['len']
            cyl = lt.get('at', 0.0)
            zw = lt.get('z', FL + 3.4)
            xw = ax
            gable_roof(lp, xw, cyl, ln, dpt * 2, zw - 1.5, 1.5, axis='y', eave_over=0.4, gable_over=0.3,
                       flare=0.25, sag=0.06, rows=5, thick=0.2, sides=(-o[0],), closed_ends=(), finial_ends=(),
                       cap=False)
            for sgn in (-1, 1):
                px_ = xw + o[0] * (dpt - 0.3)
                py_ = cyl + sgn * (ln / 2 - 0.3)
                lathe(lp, [(0.26, -0.5), (0.24, zw - 1.6)], (px_, py_, 0.0), segs=6, mat=M_TIMBER, smooth=False)
                col_box(px_, py_, (zw - 1.6) / 2, 0.26, 0.26, (zw - 1.6) / 2)
            for (rel, dx, dy, rz) in lt.get('props', []):
                prop(rel, xw + o[0] * dx, cyl + dy, 0.0, rz)
            col_box(xw + o[0] * dpt / 2, cyl, 0.7, dpt / 2 - 0.2, ln / 2 - 0.6, 0.7)
        for pr in spec.get('props', []):
            rel, x, y, rz = pr[:4]
            prop(rel, x, y, pr[4] if len(pr) > 4 else 0.0, rz)
        for (x, y, hx, hy, hz) in spec.get('prop_boxes', []):
            col_box(x, y, hz, hx, hy, hz)
        # ---- an enterable ground storey: its floor, ceiling and walls ----------
        if spec.get('enterable'):
            gz0, gz1, grect = storey_z[0]
            T_ = 0.45
            ix0, ix1, iy0, iy1 = grect[0] + T_, grect[1] - T_, grect[2] + T_, grect[3] - T_
            floor_deck(shell, ix0, ix1, iy0, iy1, FL, M_FLOOR)
            if door_o is not None:
                (dax, day), (dbx, dby) = wall_ends(door_side, base)
                dL = math.hypot(dbx - dax, dby - day)
                dcx = dax + (dbx - dax) / dL * door_o['s']
                dcy = day + (dby - day) / dL * door_o['s']
                hw_ = door_o['w'] / 2
                if door_side in 'ns':
                    y_in, y_out = (iy1, grect[3] + 0.1) if door_side == 'n' else (grect[2] - 0.1, iy0)
                    floor_deck(shell, dcx - hw_, dcx + hw_, y_in, y_out, FL, M_FLAG)
            ceiling(shell, ix0, ix1, iy0, iy1, gz1 - 0.02, joist_axis='y')
            for side in 'nwse':
                gaps = []
                if door_o is not None and side == door_side:
                    gaps = [(door_o['s'] - door_o['w'] / 2, door_o['s'] + door_o['w'] / 2,
                             door_o['z1'] + door_o['w'] / 2)]
                for eo in spec.get('extra_ops', ()):
                    if eo['storey'] == 0 and eo['side'] == side:
                        s_ = along(side, base, eo['at'])
                        gaps.append((s_ - eo['w'] / 2, s_ + eo['w'] / 2, eo['z1']))
                side_wall_col(side, grect, T_, 0.0, gz1, gaps)
        # ---- collision: storey bodies, stepped roof -----------------------------
        for si_, (z0, z1, r) in enumerate(storey_z):
            if si_ == 0 and spec.get('enterable'):
                continue                 # walls, not a block: the room is walked in
            lo = 0.0 if z0 <= FL + 0.01 else z0
            col_box((r[0] + r[1]) / 2, (r[2] + r[3]) / 2, (lo + z1) / 2, (r[1] - r[0]) / 2 + 0.18,
                    (r[3] - r[2]) / 2 + 0.18, (z1 - lo) / 2)
        rh = z_ridge - EAVE
        hx_, hy_ = (tx1 - tx0) / 2, (ty1 - ty0) / 2
        if axis == 'x':
            col_box((tx0 + tx1) / 2, (ty0 + ty1) / 2, EAVE + rh * 0.25, hx_ + 0.6, hy_ * 0.7 + 0.5, rh * 0.25)
            col_box((tx0 + tx1) / 2, (ty0 + ty1) / 2, EAVE + rh * 0.7, hx_ + 0.6, hy_ * 0.3, rh * 0.2)
        else:
            col_box((tx0 + tx1) / 2, (ty0 + ty1) / 2, EAVE + rh * 0.25, hx_ * 0.7 + 0.5, hy_ + 0.6, rh * 0.25)
            col_box((tx0 + tx1) / 2, (ty0 + ty1) / 2, EAVE + rh * 0.7, hx_ * 0.3, hy_ + 0.6, rh * 0.2)
        return dict(EAVE=EAVE, z_ridge=z_ridge, top_rect=top_rect)

    HOUSES = {
        # A: the cottage. One tall stone storey, a steep roof, a dormer, the
        # chimney breast up the west gable.
        'house_a': dict(W=9.0, D=7.6,
            storeys=[dict(h=3.95, style='stone', win=dict(n=[2.3], w=[0.6], s=2, e=[0.0]), shutters='oak', boxes=True)],
            door=dict(side='n', at=-1.4, lantern=1.8),
            roof=dict(axis='x', rise=5.2, finials=(1,), dormers=[dict(x=1.9, side='n', in_=1.2)]),
            chimneys=[dict(kind='breast', side='w', at=-0.9)],
            props=[('props/Barrel_01', 5.4, 1.6, 0.3), ('props/Box_01', 5.4, 0.4, 0.2),
                   ('props/Firewood_01', -5.3, 2.2, math.pi / 2)],
            prop_boxes=[(5.4, 1.6, 0.55, 0.55, 0.9), (5.4, 0.4, 0.5, 0.5, 0.5), (-5.3, 2.2, 0.5, 0.9, 0.5)]),
        # B: the townhouse. Stone ground floor, a jettied half-timbered upper
        # storey, a cross gable over the door, a stack chimney.
        'house_b': dict(W=12.4, D=8.2,
            storeys=[dict(h=4.0, style='stone', win=dict(n=[3.6, -3.8], s=2, e=1, w=1), shutters='oak'),
                     dict(h=3.7, style='plaster', jetty='ns', win=dict(n=3, s=3, e=1, w=1), boxes=True, lit=0.6)],
            door=dict(side='n', at=0.0, hood=True, lantern=1.6),
            roof=dict(axis='x', rise=5.0, cross=[dict(x=0.0, w=4.6, rise=3.6, window=0.9)]),
            chimneys=[dict(kind='stack', x=-3.8, y=-1.4)],
            props=[('props/Barrel_02', -7.0, 2.4, 0.9), ('props/Box_01', -7.1, 1.2, 0.3)],
            prop_boxes=[(-7.0, 2.4, 0.55, 0.55, 0.9), (-7.1, 1.2, 0.5, 0.5, 0.5)]),
        # C: the narrow house. Gable to the street, two jettied timber storeys
        # over the stone, a third timber storey up top, a corner turret.
        'house_c': dict(W=8.2, D=11.6,
            storeys=[dict(h=3.9, style='stone', win=dict(n=[2.1], e=2, w=2, s=1), shutters='oak'),
                     dict(h=3.5, style='plaster', jetty='nw', jo=0.6, win=dict(n=2, e=2, w=2, s=1), boxes=True),
                     dict(h=3.1, style='plaster', jetty='n', jo=0.5, win=dict(n=1, e=2, w=1, s=1), ww=1.0)],
            door=dict(side='n', at=-1.6, lantern=-1.6),
            roof=dict(axis='y', rise=5.6, rows=12),
            turret=dict(corner='se', r=1.45, top=9.4, stone_h=4.0, cone=5.2),     # clear of the street jetties
            chimneys=[dict(kind='stack', x=-2.2, y=-3.6, over=0.8)],
            props=[('props/Barrel_01', -5.3, -3.0, 0.2)], prop_boxes=[(-5.3, -3.0, 0.55, 0.55, 0.9)]),
        # D: the porch house. One broad stone storey, a big plastered-gable
        # roof with a cross gable, a deep porch across the front.
        'house_d': dict(W=11.6, D=10.4,
            storeys=[dict(h=4.2, style='stone', win=dict(n=[3.3, -3.3], s=2, e=2, w=2), shutters='oak', boxes=True)],
            door=dict(side='n', at=0.0, lantern=0),
            roof=dict(axis='x', rise=5.6, cross=[dict(x=0.0, w=5.4, rise=4.4, side='s')],
                      dormers=[dict(x=-3.2, side='n', in_=1.6), dict(x=3.2, side='n', in_=1.6)]),
            porch=dict(side='n', depth=2.6, w=9.4, at=0.0, z=FL + 2.85, rise=1.1),
            chimneys=[dict(kind='breast', side='e', at=-1.6)],
            props=[('props/Furniture_12', -2.8, 5.75, math.pi, FL), ('props/Barrel_01', 3.4, 6.8, 0.0, FL)],
            prop_boxes=[(-2.8, 5.75, 1.8, 0.45, 0.5 + FL / 2), (3.4, 6.8, 0.55, 0.55, 0.9 + FL / 2)]),
        # E: the long house. Stone below, half-timber above jettied to the
        # street, a cross gable over a hooded door, a lean-to, two chimneys.
        'house_e': dict(W=16.4, D=8.2,
            storeys=[dict(h=4.0, style='stone', win=dict(n=[5.2, 2.6, -4.6], s=3, e=1, w=1), shutters='oak'),
                     dict(h=3.6, style='plaster', jetty='n', win=dict(n=4, s=3, e=1, w=1), boxes=True)],
            door=dict(side='n', at=-1.0, hood=True, lantern=1.5),
            roof=dict(axis='x', rise=4.9, cross=[dict(x=-1.0, w=4.4, rise=3.5, window=0.85)],
                      dormers=[dict(x=4.8, side='n', in_=1.7), dict(x=-5.6, side='s', in_=1.7)]),
            chimneys=[dict(kind='stack', x=4.0, y=-1.5), dict(kind='breast', side='w', at=0.0)],
            leanto=dict(side='e', depth=2.8, len=5.4, at=0.2, z=FL + 3.5,
                        props=[('props/Box_01', 1.3, -1.2, 0.3), ('props/Box_01', 1.35, -1.1, 1.1),
                               ('props/Barrel_02', 1.5, 1.3, 0.0), ('props/Firewood_01', 1.0, 0.1, 0.0)])),
    }

    def make_house(key):
        def f():
            house(HOUSES[key])
            return key
        return f

    BUILDERS = {k: make_house(k) for k in HOUSES}

    # =========================================================================
    #  ENTERABLE BUILDINGS
    # =========================================================================
    def side_wall_col(side, rect, t, z0, z1, gaps=()):
        """Collision for one outer wall: the box's OUTER face on the wall line."""
        (ax, ay), (bx, by) = wall_ends(side, rect)
        L = math.hypot(bx - ax, by - ay)
        nx, ny = outward(side)
        off = t / 2
        col_wall(ax - nx * off, ay - ny * off, bx - nx * off, by - ny * off, z0, z1, t, gaps=gaps)

    def storey_walls(P, rect, z0, z1, style, ops_by_side, t=0.6, inner_mat=M_PLASTER, frame=True,
                     lit=0.75, shutters=None, boxes=False, door_cell='door_oak', open_door=True, blocked=(),
                     dressed_out=None):
        """Walls of one enterable storey (outer + inner faces), their windows
        and doors, planned against `blocked` (world obstacles, see
        world_spans) the same way house() plans a wall. Returns {side: (A, u,
        n)}; `dressed_out` receives each side's dressed spans (for a jetty's
        brackets above)."""
        wmat = {'stone': M_STONE, 'plaster': M_PLASTER, 'teal': M_TEAL, 'blue': M_BLUE}[style]
        framed = style == 'plaster' and frame
        corner = QUOIN_ZONE if style == 'stone' else POST_ZONE
        frames = {}
        for side in 'nwse':
            (ax, ay), (bx, by) = wall_ends(side, rect)
            L = math.hypot(bx - ax, by - ay)
            spans = world_spans(side, rect, blocked)
            ops = []
            wins = []
            for o in ops_by_side.get(side, []):
                if o.get('kind') == 'door':
                    reach, top = door_surround_reach(o)
                    if top > z1 - 0.3:          # the keystone clears the storey-head course
                        o['z1'] -= top - (z1 - 0.3)
                    spans.append((o['s'] - reach - 0.05, o['s'] + reach + 0.05))
                    ops.append(o)
                else:
                    o = dict(o)
                    if framed and o.get('arch'):
                        # square head between the posts, same top line
                        o['z1'] = o['z1'] + o['w'] / 2
                        o['arch'] = False
                    wins.append(o)
            placed = place_windows([o['s'] for o in wins], max([o['w'] for o in wins] or [1.2]), L, spans, corner)
            # place_windows keeps the order of the survivors; match them back
            keep = []
            for o in sorted(wins, key=lambda q: q['s']):
                if not placed:
                    break
                c = min(placed, key=lambda x: abs(x - o['s']))
                if abs(c - o['s']) <= 2.5:
                    placed.remove(c)
                    o['s'] = c
                    keep.append(o)
            ops += keep
            L, u, n = wall(P, ax, ay, bx, by, z0 - 0.02, z1, wmat, ops, t=t, inner=True, inner_mat=inner_mat)
            A = Vector((ax, ay, 0))
            frames[side] = (A, u, n)
            if framed:
                frame_wall(P, ax, ay, bx, by, z0, z1, ops)
            dressed = list(spans)
            for o in ops:
                if o.get('kind') == 'door':
                    if not o.get('leaves', True):
                        pass                         # an open archway (no door hung in it)
                    elif open_door:
                        door_leaf(P, A, u, n, o, t, cell=door_cell, open_=True)
                    else:
                        door_leaf(P, A, u, n, o, 0.35, cell=door_cell)
                    door_surround(P, A, u, n, o)
                    continue
                window_glass(P, A, u, n, o, t * 0.5, lit=RNG.random() < lit, cell=o.get('cell'))
                sh = shutters if not framed else None
                if sh:
                    a, b = shutter_span(o)
                    others = [frame_span(q) for q in ops if q is not o and q.get('kind') != 'door']
                    if not (a > corner and b < L - corner and clear_of(a, b, spans + others)) or RNG.random() > 0.7:
                        sh = None
                window_frame(P, A, u, n, o, shutters=sh, box=boxes and side == 'n', sill=True, framed=framed)
                dressed.append(shutter_span(o) if sh else frame_span(o))
            if dressed_out is not None:
                dressed_out[side] = dressed
        if style == 'stone':
            for (cx, cy, sx, sy) in ((rect[1], rect[3], 1, 1), (rect[0], rect[3], -1, 1),
                                     (rect[0], rect[2], -1, -1), (rect[1], rect[2], 1, -1)):
                quoins(P, cx, cy, z0, z1, sx, sy)
        if not framed:
            course_band(P, rect, z1 - 0.1, mat=M_DRESSED if style == 'stone' else M_TIMBER)
        return frames

    def win(s, w=1.6, z0=None, h=1.5, arch=True, cell=None):
        return dict(s=s, w=w, z0=z0, z1=None, h=h, arch=arch, kind='window', cell=cell)

    def fix_ops(ops, z0, side=None, rect=None):
        """Resolve window sills/heads relative to the storey floor, and a
        window's `s` from a WORLD coordinate (x on n/s walls, y on e/w) to
        the distance along the wall."""
        out = []
        for o in ops:
            o = dict(o)
            if o.get('kind') == 'window':
                o['z0'] = z0 + (o['z0'] if o['z0'] is not None else 1.25)
                o['z1'] = o['z0'] + o['h']
                if side is not None:
                    o['s'] = along(side, rect, o['s'])
            out.append(o)
        return out

    # -------------------------------------------------------------------------
    #  THE INN: stone common room, hearth, bar, a stair to the jettied loft
    # -------------------------------------------------------------------------
    def inn(spec):
        W, D = spec['W'], spec['D']
        T = 0.6
        H0, H1 = spec.get('h0', 5.2), spec.get('h1', 4.0)
        JO = spec.get('jetty', 0.7)
        rect = (-W / 2, W / 2, -D / 2, D / 2)
        ix0, ix1, iy0, iy1 = rect[0] + T, rect[1] - T, rect[2] + T, rect[3] - T
        Z1 = FL + H0                    # top of the ground storey
        ZU = Z1 + 0.05                  # the upper floor you stand on
        ZC = Z1 - 0.3                   # the ceiling's underside
        shell = part('shell')
        plinth(shell, rect[0] - 0.05, rect[1] + 0.05, rect[2] - 0.05, rect[3] + 0.05, FL)
        dw, dh = spec.get('door_w', 3.0), spec.get('door_h', 2.9)
        door = dict(s=W / 2 - spec.get('door_x', 0.0), w=dw, z0=FL, z1=FL + dh, arch=True, kind='door')
        ops = {k: fix_ops(v, FL, k, rect) for k, v in spec['win0'].items()}
        ops['n'] = ops.get('n', []) + [door]
        # what else hangs on these walls: the chimney breast (west), the two
        # door lanterns and the inn sign (street), the corner turret
        dxx = spec.get('door_x', 0.0)
        hy_ = spec.get('hearth_y', 0.0)
        blocked = [('band', 'w', hy_ - 1.35, hy_ + 1.35),
                   ('band', 'n', dxx - dw / 2 - 0.9 - 0.35, dxx - dw / 2 - 0.9 + 0.35),
                   ('band', 'n', dxx + dw / 2 + 0.9 - 0.35, dxx + dw / 2 + 0.9 + 0.35),
                   ('band', 'n', dxx + dw / 2 + 2.6 - 0.45, dxx + dw / 2 + 2.6 + 0.45)]
        tu = spec.get('turret')
        if tu:
            blocked.append(('disc', rect[1] + 0.5 if 'e' in tu['corner'] else rect[0] - 0.5,
                            rect[3] + JO + 0.3 if 'n' in tu['corner'] else rect[2] - JO - 0.3, tu.get('r', 1.9) + 0.45))
        dressed0 = {}
        storey_walls(shell, rect, FL, Z1, 'stone', ops, t=T, shutters=spec.get('shutters', 'oak'),
                     blocked=blocked, dressed_out=dressed0)
        # ground-floor collision: the walls, a door gap
        for side in 'nwse':
            gaps = []
            if side == 'n':
                gaps = [(door['s'] - dw / 2, door['s'] + dw / 2, FL + dh + dw / 2)]
            side_wall_col(side, rect, T, 0.0, Z1, gaps)
        # the room: floor, ceiling with joists, stair well
        SX = ix1 - 1.0                   # the stair's centre line (against the east wall)
        SW = 2.0
        sy_foot, sy_head = iy1 - 1.0, iy0 + spec.get('stair_back', 3.0)
        well = (SX - SW / 2 - 0.12, ix1, sy_head, sy_foot + 0.05)
        floor_deck(shell, ix0, well[0], iy0, iy1 + 0.05, FL, M_FLOOR)
        floor_deck(shell, well[0], ix1, sy_foot, iy1 + 0.05, FL, M_FLOOR)
        floor_deck(shell, well[0], ix1, iy0, sy_head, FL, M_FLOOR)
        # threshold through the door and the steps outside
        dx = spec.get('door_x', 0.0)
        floor_deck(shell, dx - dw / 2, dx + dw / 2, iy1 + 0.05, rect[3] + 0.1, FL, M_FLAG)    # abuts the boards (+0.05)
        ceiling(shell, ix0, ix1, iy0, iy1, ZC, joist_axis='y', skip=(well[0], well[1] + 0.1, well[2], well[3]))
        staircase(shell, SX, sy_foot, sy_head, SW, FL, ZU, side_rail=SX - SW / 2 - 0.12)
        col_box(SX - SW / 2 - 0.2, (sy_foot + sy_head) / 2, (ZU + 1.1) / 2, 0.08, (sy_foot - sy_head) / 2,
                (ZU + 1.1) / 2)
        fireplace(shell, ix0, spec.get('hearth_y', 0.0), (1, 0), width=3.6, depth=1.2, h=ZC, z0=FL)
        # ---- ground-floor furniture ------------------------------------------
        furn = part('furniture', grp='INT_L0')
        by = iy0 + 2.4                    # the bar's counter line
        bar_half = spec.get('bar_half', 4.5)
        xs = [-bar_half + 1.125 + 2.25 * i for i in range(int(round(bar_half * 2 / 2.25)))]
        for x in xs:
            prop('props/BarCounter_01', x, by, FL, math.pi, interior=True)
        prop('props/BarCounter_02', -bar_half - 0.65, by, FL, math.pi, interior=True)
        prop('props/BarCounter_02', bar_half + 0.65, by, FL, 0.0, interior=True)
        col_box(0, by, 0.95, bar_half + 1.3, 0.5, 0.95 + FL / 2)
        for i, x in enumerate([-2.4, 2.4]):
            prop('props/Furniture_03', x, iy0 + 0.46, FL, math.pi, interior=True)
            col_box(x, iy0 + 0.46, 2.0, 1.2, 0.46, 2.0)
        prop('props/Furniture_05', -bar_half + 0.4, iy0 + 0.45, FL, math.pi, interior=True)
        prop('props/Furniture_05', bar_half - 0.4, iy0 + 0.45, FL, math.pi, interior=True)
        for (bx, byy) in ((-bar_half - 2.4, iy0 + 0.9), (-bar_half - 2.4, iy0 + 2.4), (-bar_half - 3.9, iy0 + 0.9)):
            prop('props/Barrel_01', bx, byy, FL, RNG.random(), interior=True)
        col_box(-bar_half - 3.1, iy0 + 1.6, 0.9, 1.4, 1.4, 0.9)
        top = FL + 1.05 * PROP_S
        for i, x in enumerate(xs):
            prop(['props/Bottle_01', 'props/Cup_01', 'props/Bottle_04', 'props/Cup_03'][i % 4], x + 0.5, by - 0.05, top,
                 0.4 * i, interior=True)
        for i, x in enumerate([-3.4, -1.7, 0.0, 1.7, 3.4]):
            prop('props/Furniture_08', x, by + 1.3, FL, 0.3 * x, interior=True)
        # the lounge by the hearth: a bench facing the fire, a carpet
        hy = spec.get('hearth_y', 0.0)
        prop('props/Carpet_02', ix0 + 3.0, hy, FL + 0.01, math.pi / 2, s=2.6, interior=True)
        prop('props/Furniture_12', ix0 + 4.6, hy, FL, -math.pi / 2, interior=True)
        col_box(ix0 + 4.6, hy, 0.5, 0.45, 1.85, 0.5)
        # feast tables down the middle, benches both sides
        for tx in spec.get('tables', [-1.4, 4.0]):
            ty = spec.get('table_y', 1.3)
            prop('props/Table_02', tx, ty, FL, 0.0, interior=True)
            prop('props/Furniture_12', tx, ty + 1.3, FL, 0.0, interior=True)
            prop('props/Furniture_12', tx, ty - 1.3, FL, math.pi, interior=True)
            col_box(tx, ty, 0.65, 2.4, 1.75, 0.65)
            for k in range(3):
                prop(['props/PlateFood_01', 'props/Cup_02', 'props/Candle_03'][k], tx - 1.2 + 1.2 * k, ty + 0.1 * (k - 1),
                     FL + 0.67 * PROP_S, 0.5 * k, interior=True)
            chandelier(furn, tx, ty, ZC, fid=f'chandelier_{tx:+.0f}')
        # small tables by the front windows
        for (tx, ty) in spec.get('side_tables', [(ix0 + 2.6, iy1 - 1.6)]):
            prop('props/Table_01', tx, ty, FL, 0.2, interior=True)
            prop('props/Furniture_08', tx - 1.3, ty, FL, 1.2, interior=True)
            prop('props/Furniture_08', tx + 1.3, ty, FL, -1.4, interior=True)
            col_box(tx, ty, 0.7, 1.9, 0.8, 0.7)
        # walls: notice board by the door, shields over the bar, sconces
        prop('props/NoticeBoard_01', dx - dw / 2 - 2.9, iy1 - 0.35, FL, 0.0, interior=True)     # clear of the folded door leaf
        col_box(dx - dw / 2 - 2.9, iy1 - 0.35, 1.7, 0.9, 0.3, 1.7)
        prop('props/Shield_02', 0.0, iy0 + 0.1, FL + 4.2, 0.0, interior=True)
        for x in (-6.0, 6.0):
            if abs(x) < ix1 - 1.5:
                sconce(furn, x, iy0, FL + 3.4, (0, 1), fid=f'sconce_{x:+.0f}')
        # ---- the loft (H1) -------------------------------------------------
        up = part('upper', grp='H1')
        urect = expand(rect, 'ns', JO)
        jetty(up, rect[0], rect[1], rect[2], rect[3], Z1, JO, sides='ns', avoid=dressed0)
        uops = {k: fix_ops(v, Z1, k, urect) for k, v in spec['win1'].items()}
        storey_walls(up, urect, Z1, Z1 + H1, 'plaster', uops, t=0.45, boxes=True, lit=0.8,
                     blocked=[b for b in blocked if b[0] == 'disc' or b[1] == 'w'])
        uix0, uix1, uiy0, uiy1 = urect[0] + 0.45, urect[1] - 0.45, urect[2] + 0.45, urect[3] - 0.45
        for side in 'nwse':
            side_wall_col(side, urect, 0.45, Z1, Z1 + H1)
        upper_floor(up, [(uix0, well[0], uiy0, uiy1), (well[0], uix1, uiy0, well[2]), (well[0], uix1, well[3], uiy1)], ZU)
        railing(up, (well[0], well[3]), (uix1, well[3]), ZU)
        # rooms: beds along the long walls, a table in the middle
        lf = part('loft', grp='INT_H1')
        bx = [uix0 + 1.8, uix0 + 5.2, uix0 + 8.6]
        for x in bx:
            prop('props/Bed_02', x, uiy0 + 2.2, ZU, math.pi, interior=True, grp='H1')
            prop('props/Bed_03', x, uiy1 - 2.2, ZU, 0.0, interior=True, grp='H1')
            prop('props/Chest_01', x, uiy0 + 4.7, ZU, 0.0, interior=True, grp='H1')
            col_box(x, uiy0 + 2.2, ZU + 0.7, 1.2, 2.2, 0.8)
            col_box(x, uiy1 - 2.2, ZU + 0.7, 1.6, 2.2, 0.8)
        for x in bx[:-1]:
            prop('props/Furniture_04', x + 1.7, uiy0 + 0.4, ZU, math.pi, interior=True, grp='H1')
            prop('props/Candle_04', x + 1.7, uiy0 + 0.4, ZU + 0.75 * PROP_S, 0.0, interior=True, grp='H1')
        prop('props/Table_01', uix1 - 5.0, 0.0, ZU, 0.1, interior=True, grp='H1')
        prop('props/Furniture_08', uix1 - 6.3, 0.0, ZU, 1.3, interior=True, grp='H1')
        prop('props/Book_03', uix1 - 5.0, 0.1, ZU + 0.74 * PROP_S, 0.3, interior=True, grp='H1')
        prop('props/Carpet_05', uix1 - 5.0, 0.0, ZU + 0.01, 0.0, s=2.6, interior=True, grp='H1')
        col_box(uix1 - 5.0, 0.0, ZU + 0.7, 1.8, 0.8, 0.7)
        chandelier(lf, uix0 + 5.2, 0.0, Z1 + H1 - 0.2, r=0.7, fid='loft')
        # ---- roof ----------------------------------------------------------
        roofp = part('roof', grp='H2')
        EAVE = Z1 + H1
        z_ridge = gable_roof(roofp, 0, 0, W, D + 2 * JO, EAVE, spec.get('rise', 6.4), axis='x', eave_over=1.0,
                             gable_over=0.8, flare=0.38, sag=0.35, rows=12)
        cgx = spec.get('door_x', 0.0)
        gable_roof(roofp, cgx, (D / 2 + JO) - 2.6, 5.4, 5.6, EAVE, 4.6, axis='y', eave_over=0.7, gable_over=0.6,
                   flare=0.36, sag=0.18, rows=9, closed_ends=(1,), finial_ends=(1,), gable_window=1.0)
        for (dxp, side) in spec.get('dormers', [(-6.0, 'n'), (6.0, 'n'), (-3.0, 's'), (4.0, 's')]):
            face = 1 if side == 'n' else -1
            dp = part('dormer', grp='H2')
            dormer(dp, dxp, face * (D / 2 + JO - 2.1), EAVE + 1.0, 2.4, 3.0, face, wall_h=1.9, rise=1.4)
        tu = spec.get('turret')
        if tu:
            tp = part('turret')
            cx = rect[1] + 0.5 if 'e' in tu['corner'] else rect[0] - 0.5
            cy = rect[3] + JO + 0.3 if 'n' in tu['corner'] else rect[2] - JO - 0.3
            face = math.atan2(1 if 'n' in tu['corner'] else -1, 1 if 'e' in tu['corner'] else -1)
            turret(tp, cx, cy, FL, tu.get('top', EAVE + 2.0), tu.get('r', 1.9), segs=10, stone_h=Z1 - FL,
                   cone_rise=tu.get('cone', 7.5), face=face, mat_upper=M_PLASTER)
            for rot in (0.0, math.pi / 4):
                col_box(cx, cy, tu.get('top', EAVE + 2.0) / 2, tu.get('r', 1.9) * 0.95, tu.get('r', 1.9) * 0.95,
                        tu.get('top', EAVE + 2.0) / 2, ry=rot)
        ch = part('chimney', grp='H2')
        chimney_breast(ch, rect[0], spec.get('hearth_y', 0.0), (-1, 0), 2.4, Z1, z_ridge + 0.5)
        if spec.get('stack2'):
            chimney(ch, spec['stack2'][0], spec['stack2'][1], EAVE - 0.5, z_ridge + 0.6, w=1.1, d=1.0)
        col_box(rect[0] - 0.47, spec.get('hearth_y', 0.0), (z_ridge + 0.5) / 2, 0.5, 1.2, (z_ridge + 0.5) / 2)
        rh = z_ridge - EAVE
        col_box(0, 0, EAVE + rh * 0.25, W / 2 + 0.6, (D / 2 + JO) * 0.7 + 0.5, rh * 0.25)
        col_box(0, 0, EAVE + rh * 0.7, W / 2 + 0.6, (D / 2 + JO) * 0.3, rh * 0.2)
        # ---- the street front ------------------------------------------------
        ent = part('entry')
        steps(ent, dx, rect[3] + 0.1, (0, 1), dw + 0.4, FL, n_steps=2)
        # the lanterns flank the door; the one on the sign's side stands
        # beyond the sign, which hangs right beside the door
        for sgn in (-1, 1):
            wall_lantern(ent, dx + sgn * (dw / 2 + (0.9 if sgn < 0 else 2.75)), rect[3] + 0.05, FL + 3.4, (0, 1))
        hanging_sign(ent, dx + dw / 2 + 2.6, rect[3], FL + 4.3, (0, 1), spec.get('sign', 'sign_tankard'), size=1.5,
                     door=(dx, rect[3], dw, door['z1'] + dw / 2, FL))
        prop('props/Furniture_14', dx - dw / 2 - 3.6, rect[3] + 0.75, 0.0, math.pi, name='bench')
        col_box(dx - dw / 2 - 3.6, rect[3] + 0.75, 0.5, 2.7, 0.45, 0.5)
        for (bxx, byy) in ((rect[1] + 0.9, rect[3] - 1.0), (rect[1] + 0.9, rect[3] - 2.2)):
            prop('props/Barrel_02', bxx, byy, 0.0, RNG.random(), name='barrel')
            col_box(bxx, byy, 0.9, 0.55, 0.55, 0.9)
        return dict(EAVE=EAVE, z_ridge=z_ridge, reveal=dict(
            volumes=[dict(x0=rect[0] - 0.3, x1=rect[1] + 0.3, y0=0, y1=z_ridge, z0=-(rect[3] + JO + 0.3),
                          z1=-(rect[2] - JO - 0.3))],
            storeySplit=round(ZU - 0.15, 2)),
            npcs={'innkeeper': (0.0, (iy0 + by) / 2), 'hearth': (ix0 + 3.0, spec.get('hearth_y', 0.0) + 2.6)})

    TAVERNS = {
        'tavern_b': dict(W=26.0, D=15.0, door_x=-2.0, bar_half=5.6, tables=[-6.0, 0.4, 6.8], table_y=1.6,
                         side_tables=[(-9.2, 5.2), (6.4, 5.4)], hearth_y=1.0, rise=7.4, shutters='oak',
                         sign='sign_bell', stair_back=3.4,
                         turret=dict(corner='ne', r=2.0, cone=8.0),
                         stack2=(6.0, -2.4),
                         dormers=[(-8.5, 'n'), (4.5, 'n'), (-6.0, 's'), (0.5, 's'), (7.0, 's')],
                         win0={'n': [win(-8.6, 1.8), win(4.6, 1.8), win(8.8, 1.6)],
                               's': [win(x, 1.2, z0=2.8, h=1.2) for x in (-9.5, -1.0, 9.0)],
                               'w': [win(-4.6, 1.4), win(5.4, 1.4)], 'e': [win(-5.0, 1.4)]},
                         win1={'n': [win(x, 1.2, z0=0.9, h=1.6, arch=False) for x in (-9.0, -4.0, 3.5, 8.0)],
                               's': [win(x, 1.2, z0=0.9, h=1.6, arch=False) for x in (-9.0, -3.0, 3.0, 9.0)],
                               'e': [win(0.0, 1.2, z0=0.9, h=1.6, arch=False)], 'w': [win(0.0, 1.2, z0=0.9, h=1.6, arch=False)]}),
        'tavern': dict(W=20.0, D=13.0, door_x=0.0,
                       win0={'n': [win(6.2, 1.8), win(-6.2, 1.8)], 's': [win(7.0, 1.2, z0=2.8, h=1.2), win(-7.0, 1.2, z0=2.8, h=1.2)],
                             'w': [win(4.2, 1.4), win(-4.2, 1.4)], 'e': [win(-4.6, 1.4)]},
                       win1={'n': [win(x, 1.2, z0=0.9, h=1.6, arch=False) for x in (-7.0, 0.0, 7.0)],
                             's': [win(x, 1.2, z0=0.9, h=1.6, arch=False) for x in (-7.0, 0.0, 7.0)],
                             'e': [win(0.0, 1.2, z0=0.9, h=1.6, arch=False)], 'w': [win(0.0, 1.2, z0=0.9, h=1.6, arch=False)]}),
    }
    INFO = {}

    def make_inn(key):
        def f():
            INFO[key] = inn(TAVERNS[key])
            return key
        return f

    for k in TAVERNS:
        BUILDERS[k] = make_inn(k)

    # -------------------------------------------------------------------------
    #  THE SMITHY: a stone workshop and an open forge shed
    # -------------------------------------------------------------------------
    def smithy():
        W, D = 11.0, 9.0
        T = 0.6
        H0 = 4.8
        rect = (-W / 2, W / 2, -D / 2, D / 2)
        ix0, ix1, iy0, iy1 = rect[0] + T, rect[1] - T, rect[2] + T, rect[3] - T
        Z1 = FL + H0
        shell = part('shell')
        plinth(shell, rect[0] - 0.05, rect[1] + 0.05, rect[2] - 0.05, rect[3] + 0.05, FL)
        dw = 2.8
        door = dict(s=W / 2 - (-1.2), w=dw, z0=FL, z1=FL + 2.6, arch=True, kind='door')
        side_door = dict(s=D / 2, w=2.4, z0=FL, z1=FL + 2.4, arch=True, kind='door', leaves=False)   # east wall, into the shed: an open arch
        ops = {'n': [door] + fix_ops([win(3.0, 1.6)], FL, 'n', rect),
               's': fix_ops([win(-2.5, 1.3), win(2.5, 1.3)], FL, 's', rect),
               'w': fix_ops([win(0.0, 1.3)], FL, 'w', rect), 'e': [side_door]}
        storey_walls(shell, rect, FL, Z1, 'stone', ops, t=T, shutters='oak', door_cell='door_oak',
                     blocked=[('band', 'w', -2.1, 0.1),                                  # chimney breast
                              ('band', 'n', -1.2 - dw / 2 - 1.35, -1.2 - dw / 2 - 0.65),  # lantern
                              ('band', 'n', 1.6 - 0.45, 1.6 + 0.45)])                     # sign
        for side in 'nwse':
            gaps = []
            if side == 'n':
                gaps = [(door['s'] - dw / 2, door['s'] + dw / 2, FL + 2.6 + dw / 2)]
            if side == 'e':
                gaps = [(D / 2 - 1.2, D / 2 + 1.2, FL + 2.4 + 1.2)]
            side_wall_col(side, rect, T, 0.0, Z1, gaps)
        floor_deck(shell, ix0, ix1, iy0, iy1, FL, M_FLAG)
        floor_deck(shell, -1.2 - dw / 2, -1.2 + dw / 2, iy1, rect[3] + 0.1, FL, M_FLAG)
        floor_deck(shell, ix1, rect[1] + 0.05, -1.2, 1.2, FL, M_FLAG)
        # the workshop: open to the rafters (the roof hides from inside)
        furn = part('furniture', grp='INT_L0')
        prop('props/Furniture_02', ix0 + 0.46, -1.6, FL, math.pi / 2, interior=True)
        prop('props/Furniture_02', ix0 + 0.46, 1.4, FL, math.pi / 2, interior=True)
        col_box(ix0 + 0.46, -0.1, 2.1, 0.46, 2.6, 2.1)
        prop('props/Table_02', 0.0, iy0 + 1.6, FL, 0.0, interior=True)
        col_box(0.0, iy0 + 1.6, 0.65, 2.4, 0.8, 0.65)
        for k, (rel, dxp) in enumerate((('props/Weapon_01', -1.4), ('props/Helmet_01', -0.2), ('props/Weapon_02', 0.9),
                                        ('props/Blacksmith_07', 1.8))):
            prop(rel, dxp, iy0 + 1.6, FL + 0.67 * PROP_S, 0.2 * k, interior=True)
        for (x, rel) in ((-2.0, 'props/Shield_02'), (0.0, 'props/Shield_03'), (2.0, 'props/Shield_02')):
            prop(rel, x, iy0 + 0.1, FL + 2.9, 0.0, interior=True)
        for (y, rel) in ((-2.2, 'props/Weapon_03'), (-1.4, 'props/Weapon_04'), (1.4, 'props/Weapon_03')):
            prop(rel, ix1 - 0.12, y, FL + 2.2, -math.pi / 2, interior=True)
        for (bx, byy) in ((ix1 - 0.9, iy1 - 0.9), (ix1 - 2.3, iy1 - 0.8)):
            prop('props/Box_02', bx, byy, FL, RNG.random(), interior=True)
        col_box(ix1 - 1.6, iy1 - 0.85, 0.5, 1.2, 0.6, 0.5)
        prop('props/Chest_01', ix0 + 1.4, iy1 - 0.8, FL, 0.0, interior=True)
        chandelier(furn, 0.0, 0.3, Z1 - 0.3, r=0.8, fid='workshop')
        # ---- the forge shed on the east -----------------------------------
        shed = part('shed')
        SX0, SX1 = rect[1], rect[1] + 7.2
        SY0, SY1 = rect[2] - 0.2, rect[3] + 0.4
        floor_deck(shed, SX0, SX1, SY0, SY1, FL * 0.6, M_FLAG)
        plinth(shed, SX0, SX1, SY0, SY1, FL * 0.6, cap=False)
        zb = FL + 4.0
        zf = FL * 0.6
        for (px, py) in ((SX1 - 0.3, SY0 + 0.3), (SX1 - 0.3, SY1 - 0.3), (SX1 - 0.3, (SY0 + SY1) / 2)):
            # standing ON the shed floor on a dressed pad (the old base ran down
            # through the floor and poked out of the plinth's sloped face)
            cuboid(shed, (px, py, zf + 0.09), (0.58, 0.58, 0.18), M_DRESSED, faces={'-x', '+x', '-y', '+y', '+z'})
            lathe(shed, [(0.3, zf + 0.18), (0.3, zf + 0.42), (0.24, zf + 0.52), (0.24, zb - 0.45), (0.3, zb - 0.3), (0.26, zb)],
                  (px, py, 0.0), segs=8, mat=M_TIMBER, smooth=False)
            col_box(px, py, zb / 2, 0.34, 0.34, zb / 2)
            beam(shed, (px, py, zb - 1.0), (px - 1.0, py, zb - 0.1), 0.22, 0.22)
        beam(shed, (SX1 - 0.3, SY0, zb), (SX1 - 0.3, SY1, zb), 0.34, 0.4)
        gable_roof(shed, SX0, (SY0 + SY1) / 2, SY1 - SY0, 2 * (SX1 - SX0), zb, 2.4, axis='y',
                   eave_over=0.6, gable_over=0.5, flare=0.3, sag=0.1, rows=7, thick=0.22, sides=(-1,),
                   closed_ends=(), finial_ends=(), cap=False)
        # the forge (the kit's chimney forge), the coal hearth, anvil, trough, grindstone
        prop('props/Blacksmith_03', SX1 - 1.8, SY0 + 1.6, FL * 0.6, 0.0, name='forge')
        col_box(SX1 - 1.8, SY0 + 1.6, 4.3, 1.2, 1.2, 4.3)
        prop('props/Blacksmith_02', SX0 + 2.4, SY0 + 1.6, FL * 0.6, 0.4, name='coal_hearth')
        col_box(SX0 + 2.4, SY0 + 1.6, 0.8, 1.3, 1.3, 0.8)
        prop('props/Blacksmith_01', SX0 + 3.4, 0.6, FL * 0.6, math.pi / 2, name='anvil')
        col_box(SX0 + 3.4, 0.6, 0.9, 0.9, 0.9, 0.9)
        prop('props/Blacksmith_04', SX1 - 1.4, SY1 - 1.8, FL * 0.6, math.pi, name='grindstone')
        col_box(SX1 - 1.4, SY1 - 1.8, 0.8, 1.2, 0.8, 0.8)
        # quench trough: stone, filled with dark water
        cuboid(shed, (SX0 + 2.0, SY1 - 1.1, FL * 0.6 + 0.45), (2.4, 1.0, 0.9), M_STONE, faces={'-x', '+x', '-y', '+y'})
        quad(shed, [(SX0 + 0.85, SY1 - 1.55, FL * 0.6 + 0.8), (SX0 + 3.15, SY1 - 1.55, FL * 0.6 + 0.8),
                    (SX0 + 3.15, SY1 - 0.65, FL * 0.6 + 0.8), (SX0 + 0.85, SY1 - 0.65, FL * 0.6 + 0.8)], M_DARK)
        col_box(SX0 + 2.0, SY1 - 1.1, 0.5, 1.2, 0.5, 0.5)
        # the east side stays OPEN between the forge and the grindstone: the
        # shed is walked into from the street (a barrel stack used to wall it)
        prop('props/Barrel_01', SX1 - 0.6, SY1 - 0.5, FL * 0.6, 0.3, name='barrel')
        col_box(SX1 - 0.6, SY1 - 0.5, 0.8, 0.5, 0.5, 0.8)
        flame('forge', 'bonfire', SX1 - 1.8, SY0 + 1.6 + 0.45, FL * 0.6 + 0.9, 0.45)
        flame('coals', 'embers', SX0 + 2.4, SY0 + 1.6, FL * 0.6 + 0.85, 0.5)
        # ---- roof, chimney, street front -------------------------------------
        roofp = part('roof', grp='H2')
        z_ridge = gable_roof(roofp, 0, 0, W, D, Z1, 4.8, axis='x', eave_over=0.9, gable_over=0.7, flare=0.36,
                             sag=0.25, rows=10, gable_mat=M_PLASTER)
        dp = part('dormer', grp='H2')
        dormer(dp, 2.4, D / 2 - 1.9, Z1 + 0.9, 2.3, 3.0, 1, wall_h=1.8, rise=1.3)
        ch = part('chimney', grp='H2')
        chimney_breast(ch, rect[0], -1.0, (-1, 0), 2.0, Z1, z_ridge + 0.5)
        col_box(rect[0] - 0.47, -1.0, (z_ridge + 0.5) / 2, 0.5, 1.0, (z_ridge + 0.5) / 2)
        rh = z_ridge - Z1
        col_box(0, 0, Z1 + rh * 0.25, W / 2 + 0.6, D / 2 * 0.7 + 0.5, rh * 0.25)
        col_box(0, 0, Z1 + rh * 0.7, W / 2 + 0.6, D / 2 * 0.3, rh * 0.2)
        ent = part('entry')
        steps(ent, -1.2, rect[3] + 0.1, (0, 1), dw + 0.3, FL, n_steps=2)
        wall_lantern(ent, -1.2 - dw / 2 - 1.0, rect[3] + 0.05, FL + 3.2, (0, 1))
        hanging_sign(ent, 1.6, rect[3], FL + 4.0, (0, 1), 'sign_anvil', size=1.4,
                     door=(-1.2, rect[3], dw, door['z1'] + dw / 2, FL))
        return dict(EAVE=Z1, z_ridge=z_ridge, reveal=dict(
            volumes=[dict(x0=rect[0] - 0.3, x1=rect[1] + 0.3, y0=0, y1=z_ridge, z0=-(rect[3] + 0.3), z1=-(rect[2] - 0.3)),
                     dict(x0=SX0, x1=SX1 + 0.6, y0=0, y1=zb + 2.4, z0=-(SY1 + 0.6), z1=-(SY0 - 0.6))]),
            npcs={})

    # -------------------------------------------------------------------------
    #  THE MARKET HALL: an open stone arcade under a great roof and a lantern
    # -------------------------------------------------------------------------
    def market():
        W, D = 27.0, 15.0
        FLM = 0.25
        rect = (-W / 2, W / 2, -D / 2, D / 2)
        ZA = FLM + 5.4          # arcade top (arch crowns under it)
        ZE = ZA + 2.2           # the clerestory band's top: the eave
        shell = part('shell')
        plinth(shell, rect[0] - 0.05, rect[1] + 0.05, rect[2] - 0.05, rect[3] + 0.05, FLM, z_bot=-0.8, flare=0.25)
        floor_deck(shell, rect[0] + 0.1, rect[1] - 0.1, rect[2] + 0.1, rect[3] - 0.1, FLM, M_FLAG)
        # piers: 5 bays on the long sides, 3 on the ends
        xs = [rect[0] + W * i / 5 for i in range(6)]
        ys = [rect[2] + D * i / 3 for i in range(4)]
        piers = set()
        for x in xs:
            piers.add((round(x, 3), rect[2]))
            piers.add((round(x, 3), rect[3]))
        for y in ys:
            piers.add((rect[0], round(y, 3)))
            piers.add((rect[1], round(y, 3)))
        PW = 1.2
        for (px, py) in sorted(piers):
            # a touch wider than the openings between them: the arch reveals
            # (dressed) end on the opening edges, and a pier face ON that
            # plane z-fights all the way up
            cuboid(shell, (px, py, (FLM + ZA) / 2 - 0.2), (PW + 0.06, PW + 0.06, ZA - FLM + 0.4), M_STONE,
                   faces={'-x', '+x', '-y', '+y'})
            cuboid(shell, (px, py, FLM + 0.3), (PW + 0.3, PW + 0.3, 0.6), M_DRESSED, faces={'-x', '+x', '-y', '+y', '+z'})
            cuboid(shell, (px, py, ZA - 1.3), (PW + 0.25, PW + 0.25, 0.3), M_DRESSED, faces={'-x', '+x', '-y', '+y', '-z', '+z'})
            col_box(px, py, ZE / 2, PW / 2 + 0.1, PW / 2 + 0.1, ZE / 2)
        # arches between piers: a wall band from the springing to the eave with
        # one big arched opening per bay (the arches are open to the ground)
        for side in 'nwse':
            (ax, ay), (bx, by) = wall_ends(side, rect)
            L = math.hypot(bx - ax, by - ay)
            nb = 5 if side in 'ns' else 3
            bay = L / nb
            ops = [dict(s=bay * (i + 0.5), w=bay - PW, z0=FLM, z1=ZA - 1.6 - (bay - PW) / 2 + 0.2, arch=True)
                   for i in range(nb)]
            wall(shell, ax, ay, bx, by, FLM, ZA, M_STONE, ops, t=0.7, inner=True, inner_mat=M_STONE, reveal_mat=M_DRESSED)
            # the clerestory: half-timber over the arcade, small windows
            up_ops = [dict(s=bay * (i + 0.5), w=1.1, z0=ZA + 0.45, z1=ZA + 1.5, arch=False) for i in range(nb)]
            L2, u2, n2 = wall(shell, ax, ay, bx, by, ZA, ZE, M_PLASTER, up_ops, t=0.45, inner=True, inner_mat=M_PLASTER)
            frame_wall(shell, ax, ay, bx, by, ZA, ZE, up_ops, braces=True, post_every=1.6)
            A = Vector((ax, ay, 0))
            for o in up_ops:
                window_glass(shell, A, u2, n2, o, 0.22, lit=True)
            # a dressed string course at the springing
            # (1.0 deep: its inner face stands clear of the clerestory's inner
            # skin; the end bands fit BETWEEN the long ones, no corner overlap)
            cuboid(shell, ((ax + bx) / 2, (ay + by) / 2, ZA - 0.05), (abs(bx - ax) + 1.0 if side in 'ns' else 1.0,
                   abs(by - ay) - 1.0 if side in 'ew' else 1.0, 0.3), M_DRESSED, faces={'-x', '+x', '-y', '+y', '-z', '+z'})
        # collision above the arches only (the arcade is open)
        for side in 'nwse':
            side_wall_col(side, rect, 0.7, ZA - 1.6, ZE)
        # ---- roof: a great hip-less gable with a lantern cupola ---------------
        roofp = part('roof', grp='H2')
        z_ridge = gable_roof(roofp, 0, 0, W, D, ZE, 7.0, axis='x', eave_over=1.2, gable_over=0.9, flare=0.4,
                             sag=0.35, rows=12, gable_mat=M_PLASTER, gable_window=1.6)
        for (cgx, side) in ((-6.8, 'n'), (6.8, 'n'), (0.0, 's')):
            face = 1 if side == 'n' else -1
            gable_roof(roofp, cgx, face * (D / 2 - 2.4), 4.8, 5.0, ZE, 4.2, axis='y', eave_over=0.7, gable_over=0.55,
                       flare=0.36, sag=0.15, rows=8, closed_ends=(face,), finial_ends=(face,), gable_window=0.9)
        cup = part('cupola', grp='H2')
        cz = z_ridge - 0.6
        R = 2.1
        lathe(cup, [(R + 0.3, cz - 0.4), (R + 0.3, cz + 0.1), (R, cz + 0.2)], (0, 0, 0), segs=8, mat=M_DRESSED,
              smooth=False, cap_top=False)
        for i in range(8):
            a0, a1 = TAU * i / 8, TAU * (i + 1) / 8
            p0 = (math.cos(a0) * R, math.sin(a0) * R)
            p1 = (math.cos(a1) * R, math.sin(a1) * R)
            glass_face(cup, [(p0[0], p0[1], cz + 0.2), (p1[0], p1[1], cz + 0.2), (p1[0], p1[1], cz + 2.6),
                             (p0[0], p0[1], cz + 2.6)],
                       [cell_uv('win_arch_lit', a_, b_) for (a_, b_) in ((0.1, 0.05), (0.9, 0.05), (0.9, 0.9), (0.1, 0.9))],
                       (p0[0] + p1[0], p0[1] + p1[1], 0.0),
                       [cell_uv('win_arch_dark', a_, b_) for (a_, b_) in ((0.1, 0.05), (0.9, 0.05), (0.9, 0.9), (0.1, 0.9))])
            beam(cup, (p0[0], p0[1], cz + 0.2), (p0[0], p0[1], cz + 2.7), 0.2, 0.2, mat=M_GOLD)
        cone_roof(cup, 0, 0, cz + 2.7, R, 3.6, segs=8, flare=0.5, over=0.4, finial_h=2.4)
        # ---- the market inside --------------------------------------------------
        furn = part('stalls', grp='INT_L0')
        stalls = [('props/Market_01', -8.5, -3.2, math.pi), ('props/Market_02', -2.8, -3.2, math.pi),
                  ('props/Market_03', 2.8, -3.2, math.pi), ('props/Market_04', 8.5, -3.2, math.pi),
                  ('props/Market_02', -5.6, 3.2, 0.0), ('props/Market_01', 5.6, 3.2, 0.0)]
        for (rel, x, y, rz) in stalls:
            prop(rel, x, y, FLM, rz, interior=True)
            col_box(x, y + (0.9 if rz == 0.0 else -0.9), 0.7, 2.7, 0.6, 0.7)
        goods = ['props/Food_01', 'props/Food_04', 'props/Food_07', 'props/Potion_02', 'props/Bag_01', 'props/Food_10']
        for i, (rel, x, y, rz) in enumerate(stalls):
            for k in range(3):
                g = goods[(i + k) % len(goods)]
                prop(g, x - 1.1 + 1.1 * k, y + (0.8 if rz == 0.0 else -0.8), FLM + 1.55, RNG.random(), interior=True)
        for (x, y) in ((-12.0, 0.0), (12.0, 0.0), (0.0, 0.0)):
            prop('props/Barrel_01', x - 0.7, y - 0.5, FLM, RNG.random(), interior=True)
            prop('props/Box_01', x + 0.6, y + 0.4, FLM, RNG.random(), interior=True)
            prop('props/Bag_02', x + 0.2, y - 0.9, FLM, RNG.random(), interior=True)
            col_box(x, y, 0.8, 1.2, 1.2, 0.8)
        for (x, y) in ((-6.0, 0.0), (6.0, 0.0)):
            chandelier(furn, x, y, ZE + 0.5, r=1.1, fid=f'lamp_{x:+.0f}')
        # hanging banners under the clerestory, between the arches
        for x in (-8.1, 0.0, 8.1):
            banner(furn, (x, rect[3] - 0.45, ZA + 1.9), (1, 0, 0), (0, -1, 0), 2.2, 3.4, sway=0.1)
            banner(furn, (x, rect[2] + 0.45, ZA + 1.9), (-1, 0, 0), (0, 1, 0), 2.2, 3.4, sway=0.1)
        return dict(EAVE=ZE, z_ridge=z_ridge, reveal=dict(
            volumes=[dict(x0=rect[0] - 0.5, x1=rect[1] + 0.5, y0=0, y1=z_ridge + 4, z0=-(rect[3] + 0.5), z1=-(rect[2] - 0.5))]),
            npcs={})

    # -------------------------------------------------------------------------
    #  THE AUCTION HOUSE (the old market hall's site): a grand stone hall
    # -------------------------------------------------------------------------
    def auction_house():
        """The Warden Market's auction house (SPACEY, 2026-09-26: "a main big
        building with tons of room and epic world of warcraft inspired design
        ... make it epic and grand", his Stormwind references): a raised stone
        hall behind a four-column portico with a pediment, steps and banners; a
        great slate roof with rose-window gables and a glazed lantern; inside a
        coffered ceiling with a stone cornice and a gold band, hanging lanterns,
        a teal runner between brass rope stanchions, and auctioneers' booths on
        stepped stone counters with blue panels, lecterns and blue drapes, the
        wares stacked behind them."""
        W, D = 32.0, 19.0
        T = 0.7
        FLA = 0.9                                   # a raised floor: the portico's podium height
        H = 8.4
        Z1 = FLA + H
        rect = (-W / 2, W / 2, -D / 2, D / 2)
        ix0, ix1, iy0, iy1 = rect[0] + T, rect[1] - T, rect[2] + T, rect[3] - T
        up = Vector((0, 0, 1))
        shell = part('shell')
        plinth(shell, rect[0] - 0.05, rect[1] + 0.05, rect[2] - 0.05, rect[3] + 0.05, FLA)
        dw, dh = 3.2, 3.4
        door = dict(s=W / 2 - 0.0, w=dw, z0=FLA, z1=FLA + dh, arch=True, kind='door')
        hi = dict(z0=3.3, h=2.9)                    # the tall windows sit high: booths and wares below
        ops = {'n': [door] + fix_ops([win(x, 1.8, z0=1.9, h=3.3) for x in (-11.6, -6.6, 6.6, 11.6)], FLA, 'n', rect),
               's': fix_ops([win(x, 1.7, **hi) for x in (-11.8, -4.2, 4.2, 11.8)], FLA, 's', rect),
               'e': fix_ops([win(y, 1.7, **hi) for y in (-5.6, 0.0, 5.6)], FLA, 'e', rect),
               'w': fix_ops([win(y, 1.7, **hi) for y in (-5.6, 0.0, 5.6)], FLA, 'w', rect)}
        storey_walls(shell, rect, FLA, Z1, 'stone', ops, t=T, inner_mat=M_STONE, shutters=None,
                     door_cell='door_oak', blocked=[('band', 'n', -3.4, -2.2), ('band', 'n', 2.2, 3.4)])
        for side in 'nwse':
            gaps = [(door['s'] - dw / 2, door['s'] + dw / 2, FLA + dh + dw / 2)] if side == 'n' else []
            side_wall_col(side, rect, T, 0.0, Z1, gaps)
        floor_deck(shell, ix0, ix1, iy0, iy1, FLA, M_FLAG)
        floor_deck(shell, -dw / 2, dw / 2, iy1, rect[3] + 0.1, FLA, M_FLAG)
        # ---- the coffered ceiling, cornice and gold band -------------------------
        zc = Z1 - 0.02
        quad(shell, [(ix0, iy0, zc), (ix0, iy1, zc), (ix1, iy1, zc), (ix1, iy0, zc)], M_PLASTER, tint=(1.0, 0.95, 0.82))
        pitch_x = (ix1 - ix0) / 8
        pitch_y = (iy1 - iy0) / 5
        for i in range(1, 8):                         # ribs across the hall (the deeper set)
            x = ix0 + pitch_x * i
            beam(shell, (x, iy0 + 0.6, zc - 0.21), (x, iy1 - 0.6, zc - 0.21), 0.38, 0.42, mat=M_TIMBER)
        for j in range(1, 5):                         # ribs along it (shallower: no shared bottom plane)
            y = iy0 + pitch_y * j
            beam(shell, (ix0 + 0.6, y, zc - 0.19), (ix1 - 0.6, y, zc - 0.19), 0.32, 0.34, mat=M_TIMBER)   # top 2 cm under the other set's
            for i in range(1, 8):
                cuboid(shell, (ix0 + pitch_x * i, y, zc - 0.47), (0.3, 0.3, 0.14), M_GOLD, tint=(0.8, 0.7, 0.5))
        # the cornice round the walls (the long runs over the corners, the ends between)
        for (cx, cy, sx, sy, dz) in (((ix0 + ix1) / 2, iy0 + 0.3, ix1 - ix0, 0.6, 0.0),
                                     ((ix0 + ix1) / 2, iy1 - 0.3, ix1 - ix0, 0.6, 0.0),
                                     (ix0 + 0.3, (iy0 + iy1) / 2, 0.58, iy1 - iy0 - 1.2, 0.02),
                                     (ix1 - 0.3, (iy0 + iy1) / 2, 0.58, iy1 - iy0 - 1.2, 0.02)):
            cuboid(shell, (cx, cy, zc - 0.35 + dz), (sx, sy, 0.7 - dz * 2), M_DRESSED)
            # a gold band under it (the end runs stop short of the long ones and
            # sit 2 cm lower: no shared faces at the corners)
            if sx > sy:
                cuboid(shell, (cx, cy + (0.16 if cy < 0 else -0.16), zc - 0.79), (sx + 0.04, sy * 0.45 + 0.02, 0.1),
                       M_GOLD, tint=(0.85, 0.72, 0.45))
            else:
                cuboid(shell, (cx + (0.16 if cx < 0 else -0.16), cy, zc - 0.81), (sx * 0.45, sy - 0.5, 0.1),
                       M_GOLD, tint=(0.85, 0.72, 0.45))
        # ---- the portico ---------------------------------------------------------
        por = part('portico')
        PW, PD = 15.0, 5.4
        y0, y1 = rect[3], rect[3] + PD
        cuboid(por, (0.0, (y0 + y1) / 2, (FLA - 0.8) / 2), (PW, PD, FLA + 0.8), M_DRESSED,
               faces={'-x', '+x', '+y'})
        floor_deck(por, -PW / 2, PW / 2, y0 + 0.05, y1, FLA, M_FLAG)
        steps(por, 0.0, y1, (0, 1), PW - 2.4, FLA, n_steps=3)
        z_top = FLA + 4.9
        for x in (-6.2, -2.1, 2.1, 6.2):
            lathe(por, [(0.62, FLA), (0.62, FLA + 0.32), (0.5, FLA + 0.44), (0.44, FLA + 0.56), (0.4, z_top - 0.62),
                        (0.48, z_top - 0.46), (0.62, z_top - 0.28), (0.66, z_top - 0.02)], (x, y1 - 0.75, 0.0), segs=12,
                  mat=M_DRESSED, cap_top=False, smooth=True)
            col_box(x, y1 - 0.75, (FLA + z_top) / 2, 0.55, 0.55, (z_top - FLA) / 2)
        # the entablature over the columns, a gold frieze band on its face
        cuboid(por, (0.0, y1 - 0.75, z_top + 0.36), (PW + 0.3, 1.8, 0.72), M_DRESSED)
        cuboid(por, (0.0, y1 + 0.18, z_top + 0.34), (PW + 0.1, 0.06, 0.2), M_GOLD, tint=(0.85, 0.72, 0.45),
               faces={'+y', '-z', '+z', '-x', '+x'})
        gable_roof(por, 0.0, (y0 + y1) / 2 + 0.1, PD + 0.2, PW + 0.3, z_top + 0.72, 1.9, axis='y', eave_over=0.45,
                   gable_over=0.5, flare=0.3, sag=0.05, rows=6, thick=0.24, gable_mat=M_DRESSED, gable_frame=False,
                   gable_window=1.05, closed_ends=(1,), finial_ends=(1,), sides=(-1, 1))
        for sgn in (-1, 1):
            wall_lantern(por, sgn * 2.8, y0 + 0.05, FLA + 3.2, (0, 1))
            # a free-standing flagstaff on the street either side of the steps, in
            # front of the pediment's overhang (clear of the roof and entablature):
            # a dressed stone plinth sunk into the ground, the staff rising out of it
            px_, py_ = sgn * (PW / 2 - 0.2), y1 + 1.25
            cuboid(por, (px_, py_, 0.1), (0.95, 0.95, 0.8), M_DRESSED, faces={'-x', '+x', '-y', '+y', '+z'})
            cuboid(por, (px_, py_, 0.58), (0.78, 0.78, 0.16), M_DRESSED, faces={'-x', '+x', '-y', '+y', '+z'})
            lathe(por, [(0.2, 0.66), (0.2, 0.86), (0.1, 0.98), (0.085, 8.1), (0.15, 8.25), (0.0, 8.55)],
                  (px_, py_, 0.0), segs=8, mat=M_GOLD, cap_top=False)
            banner(por, (px_, py_ + 0.12, 7.7), (1, 0, 0), (0, 1, 0), 1.6, 3.6, sway=0.14)
            col_box(px_, py_, 0.2, 0.48, 0.48, 0.5)
            col_box(px_, py_, 4.5, 0.12, 0.12, 3.9)
        # ---- buttresses between the windows, a dressed cornice at the eave -------
        bt = part('buttresses')
        course_band(bt, rect, Z1 - 0.1, out=0.2, h=0.3)
        for (side, xs_) in (('s', (-8.0, 0.0, 8.0)), ('n', (-9.1, 9.1)), ('e', (-2.8, 2.8)), ('w', (-2.8, 2.8))):
            o = outward(side)
            for c_ in xs_:
                if side in 'ns':
                    bx_, by_ = c_, (rect[3] if side == 'n' else rect[2])
                    u_ = Vector((1, 0, 0))
                else:
                    bx_, by_ = (rect[1] if side == 'e' else rect[0]), c_
                    u_ = Vector((0, 1, 0))
                n_ = Vector((o[0], o[1], 0))
                Rb = Matrix((u_, n_, Vector((0, 0, 1)))).transposed()
                base = Vector((bx_, by_, 0))
                for (d_, w_, z0_, z1_, m_) in ((0.95, 1.2, -0.6, FLA + 4.2, M_STONE), (0.6, 1.0, FLA + 4.2, Z1 - 1.0, M_STONE)):
                    cuboid(bt, tuple(base + n_ * (d_ / 2) + Vector((0, 0, (z0_ + z1_) / 2))), (w_, d_, z1_ - z0_), m_,
                           rot=Rb, faces={'-x', '+x', '+y'} if Rb.determinant() > 0 else {'-x', '+x', '-y'})
                    cuboid(bt, tuple(base + n_ * (d_ / 2 + 0.04) + Vector((0, 0, z1_ + 0.09))), (w_ + 0.12, d_ + 0.08, 0.18),
                           M_DRESSED, rot=Rb)
                col_box(bx_ + o[0] * 0.48, by_ + o[1] * 0.48, (FLA + 4.2) / 2, 0.6 if side in 'ns' else 0.48,
                        0.48 if side in 'ns' else 0.6, (FLA + 4.2) / 2)
        # ---- two stone towers flanking the front -------------------------------------
        for sgn in (-1, 1):
            tp = part('tower')
            r_ = 2.3
            tcx, tcy = sgn * (W / 2 + r_ * 0.3), rect[3] + r_ * 0.3
            # (an upper drum 4 yd tall above the hall's eave: its windows clear the cone's skirt)
            turret(tp, tcx, tcy, FLA, Z1 + 3.6, r_, segs=10, stone_h=Z1 - 0.5 - FLA, cone_rise=7.4, windows=3,
                   face=math.atan2(1, sgn), mat_upper=M_STONE)
            for rot in (0.0, math.pi / 4):
                col_box(tcx, tcy, (Z1 + 3.4) / 2, r_ * 0.95, r_ * 0.95, (Z1 + 3.4) / 2, ry=rot)
        # ---- the great roof and its lantern --------------------------------------
        roofp = part('roof', grp='H2')
        z_ridge = gable_roof(roofp, 0, 0, W, D, Z1, 8.2, axis='x', eave_over=1.2, gable_over=0.9, flare=0.42,
                             sag=0.3, rows=13, gable_mat=M_DRESSED, gable_frame=False, gable_window=2.0)
        for (dx_, side) in ((-9.0, 'n'), (9.0, 'n'), (-9.0, 's'), (0.0, 's'), (9.0, 's')):
            dp = part('dormer', grp='H2')
            face = 1 if side == 'n' else -1
            dormer(dp, dx_, face * (D / 2 - 2.1), Z1 + 1.3, 2.5, 3.0, face, wall_h=2.0, rise=1.5, mat_wall=M_DRESSED)
        cup = part('cupola', grp='H2')
        cz = z_ridge - 0.7
        R = 2.6
        env_lathe(cup, [(R + 0.35, cz - 0.5), (R + 0.35, cz + 0.12), (R, cz + 0.22), (R, cz + 3.1)], (0, 0, 0), segs=8)
        lathe(cup, [(R + 0.35, cz - 0.5), (R + 0.35, cz + 0.12), (R, cz + 0.22)], (0, 0, 0), segs=8, mat=M_DRESSED,
              smooth=False, cap_top=False)
        for i in range(8):
            a0, a1 = TAU * i / 8, TAU * (i + 1) / 8
            p0 = (math.cos(a0) * R, math.sin(a0) * R)
            p1 = (math.cos(a1) * R, math.sin(a1) * R)
            glass_face(cup, [(p0[0], p0[1], cz + 0.22), (p1[0], p1[1], cz + 0.22), (p1[0], p1[1], cz + 3.0),
                             (p0[0], p0[1], cz + 3.0)],
                       [cell_uv('win_arch_lit', a_, b_) for (a_, b_) in ((0.1, 0.05), (0.9, 0.05), (0.9, 0.9), (0.1, 0.9))],
                       (p0[0] + p1[0], p0[1] + p1[1], 0.0),
                       [cell_uv('win_arch_dark', a_, b_) for (a_, b_) in ((0.1, 0.05), (0.9, 0.05), (0.9, 0.9), (0.1, 0.9))])
            beam(cup, (p0[0], p0[1], cz + 0.22), (p0[0], p0[1], cz + 3.1), 0.22, 0.22, mat=M_GOLD)
        cone_roof(cup, 0, 0, cz + 3.1, R, 4.2, segs=8, flare=0.5, over=0.45, finial_h=2.8)
        # ---- the hall: runner, stanchions, lanterns, banners ------------------------
        furn = part('furniture', grp='INT_L0')
        booth_y = iy0 + 4.0                           # the back booths' customer face
        ry0, ry1 = booth_y + 1.2, iy1 - 0.25
        # (the canvas material: the cloth map is blue, so a teal or gold tint
        # on it came out blue)
        quad(furn, [(-1.7, ry0, FLA + 0.02), (1.7, ry0, FLA + 0.02), (1.7, ry1, FLA + 0.02), (-1.7, ry1, FLA + 0.02)],
             M_PLASTER, tint=(0.07, 0.24, 0.23))
        for sgn in (-1, 1):                            # its gold border, a hair above
            quad(furn, [(sgn * 1.7 - 0.13, ry0 + 0.14, FLA + 0.04), (sgn * 1.7 + 0.13, ry0 + 0.14, FLA + 0.04),
                        (sgn * 1.7 + 0.13, ry1, FLA + 0.04), (sgn * 1.7 - 0.13, ry1, FLA + 0.04)], M_PLASTER,
                 tint=(0.85, 0.6, 0.18))
        quad(furn, [(-1.83, ry0 - 0.13, FLA + 0.06), (1.83, ry0 - 0.13, FLA + 0.06), (1.83, ry0 + 0.14, FLA + 0.06),
                    (-1.83, ry0 + 0.14, FLA + 0.06)], M_PLASTER, tint=(0.85, 0.6, 0.18))
        posts = []
        yy = ry1 - 1.4
        while yy > ry0 + 0.6:
            for sgn in (-1, 1):
                x = sgn * 2.45
                lathe(furn, [(0.2, FLA), (0.2, FLA + 0.06), (0.06, FLA + 0.12), (0.05, FLA + 0.95), (0.09, FLA + 1.0),
                             (0.0, FLA + 1.1)], (x, yy, 0.0), segs=8, mat=M_GOLD, cap_top=False)
                col_box(x, yy, FLA + 0.5, 0.12, 0.12, 0.5)
                posts.append((x, yy))
            yy -= 2.6
        for sgn in (-1, 1):
            pts = [p for p in posts if (p[0] > 0) == (sgn > 0)]
            for (a, b) in zip(pts, pts[1:]):
                prev = None
                for k in range(7):
                    f = k / 6
                    q = Vector((a[0], a[1] + (b[1] - a[1]) * f, FLA + 0.92 - 0.22 * math.sin(math.pi * f)))
                    if prev is not None:
                        beam(furn, prev, q, 0.05, 0.05, mat=M_PLASTER, tint=(0.62, 0.08, 0.07))
                    prev = q
        for (x, y) in ((-9.0, 2.0), (9.0, 2.0), (-9.0, -3.5), (9.0, -3.5)):
            hanging_lantern(furn, x, y, zc - 0.42, 2.6)
        chandelier(furn, 0.0, 1.0, zc - 0.42, r=1.6, fid='ah_chandelier')
        for x in (-4.0, 4.0):
            banner(furn, (x, iy1 - 0.05, Z1 - 1.2), (-1, 0, 0), (0, -1, 0), 2.0, 3.6, sway=0.08)
        # ---- the auctioneers' booths ---------------------------------------------
        def booth(cx, cy, ux, uy, L, drape=True, wares=0):
            """A stepped stone counter centred at (cx, cy) on the floor, its
            customer face toward (-uy, ux) rotated... n = the customer side."""
            u = Vector((ux, uy, 0)).normalized()
            n = Vector((-u.y, u.x, 0))
            R = Matrix((u, n, up)).transposed()
            c = Vector((cx, cy, 0))
            h, dpt = 1.2, 1.0
            body = c - n * (dpt / 2)
            cuboid(furn, tuple(body + up * (FLA + 0.1)), (L, dpt - 0.1, 0.2), M_DRESSED, rot=R, tint=(0.6, 0.6, 0.62),
                   faces={'-x', '+x', '-y', '+y', '+z'})
            cuboid(furn, tuple(body + up * (FLA + 0.2 + (h - 0.36) / 2)), (L - 0.12, dpt - 0.2, h - 0.36), M_DRESSED,
                   rot=R, faces={'-x', '+x', '-y', '+y'})
            cuboid(furn, tuple(body + n * 0.04 + up * (FLA + h - 0.08)), (L + 0.16, dpt + 0.12, 0.16), M_DRESSED, rot=R,
                   tint=(0.95, 0.95, 0.97))
            # blue panels in stone frames on the customer face, 2 cm proud
            k = max(1, int(round(L / 1.6)))
            for i in range(k):
                pc = c - n * 0.06 + u * (-L / 2 + (i + 0.5) * L / k) + n * 0.02
                pw, ph = L / k - 0.36, h - 0.62
                corners = [pc - u * pw / 2 + up * (FLA + 0.33), pc + u * pw / 2 + up * (FLA + 0.33),
                           pc + u * pw / 2 + up * (FLA + 0.33 + ph), pc - u * pw / 2 + up * (FLA + 0.33 + ph)]
                # the painted panel stops where its frame starts (no face under the frame)
                q = [tuple(v) for v in (pc - u * (pw / 2 - 0.05) + up * (FLA + 0.38), pc + u * (pw / 2 - 0.05) + up * (FLA + 0.38),
                                        pc + u * (pw / 2 - 0.05) + up * (FLA + 0.28 + ph), pc - u * (pw / 2 - 0.05) + up * (FLA + 0.28 + ph))]
                a, b_, cc = Vector(q[0]), Vector(q[1]), Vector(q[2])
                if (b_ - a).cross(cc - a).dot(n) < 0:
                    q = q[::-1]
                quad(furn, q, M_BLUE, tint=(0.8, 0.9, 1.0))
                for (e0, e1) in ((0, 1), (1, 2), (2, 3), (3, 0)):
                    # the stiles 2.5 cm shallower than the rails: no shared face where they cross
                    beam(furn, corners[e0], corners[e1], 0.1, 0.07 if e0 in (0, 2) else 0.035, mat=M_DRESSED, up=n)
            col_box(body.x, body.y, FLA + h / 2, (L / 2 + 0.1) if abs(u.x) > 0.5 else dpt / 2 + 0.1,
                    dpt / 2 + 0.1 if abs(u.x) > 0.5 else (L / 2 + 0.1), h / 2 + FLA / 2)
            if drape:
                back = c - n * (dpt + 1.3)
                # the lectern's reading slope toward the auctioneer behind it, who
                # faces the crowd over it (SPACEY, 2026-09-26: "these auction lecturn
                # boards are facing the wrong way they need to have characters
                # standing behind them facing the crowd of people")
                prop('props/Altar_01', (c - n * (dpt + 0.45)).x, (c - n * (dpt + 0.45)).y, FLA,
                     math.atan2(-n.x, n.y), interior=True)       # kit scale: it stands clear of the counter
                drape_frame(furn, back - u * min(L / 2 - 0.3, 1.9), back + u * min(L / 2 - 0.3, 1.9), FLA, FLA + 4.6, n)
                spot = c - n * (dpt + 1.05)                  # between the lectern and the drape
                SPOTS.append((spot.x, spot.y))
            return c, u, n
        # the back: a long counter with three booths stepping forward
        SPOTS = []                     # an auctioneer behind every lectern
        booth(-10.4, booth_y - 0.9, 1, 0, 5.2, drape=False)
        booth(10.4, booth_y - 0.9, 1, 0, 5.2, drape=False)
        for x in (-5.4, 0.0, 5.4):
            booth(x, booth_y, 1, 0, 4.4)
        # the sides: one booth on each long wall
        booth(ix0 + 3.2, 0.2, 0, -1, 5.6)
        booth(ix1 - 3.2, 0.2, 0, 1, 5.6)
        # wares behind the booths
        for (rel, x, y, rz, sc_) in (('props/Box_02', -12.6, iy0 + 0.9, 0.2, 1.1), ('props/Box_01', -12.6, iy0 + 0.9, 0.6, 1.0),
                                     ('props/Barrel_01', -8.6, iy0 + 0.8, 0.0, None), ('props/Barrel_02', -7.4, iy0 + 0.9, 1.0, None),
                                     ('props/Chest_01', -3.0, iy0 + 0.8, math.pi, None), ('props/Box_01', 3.0, iy0 + 0.8, 0.3, 1.2),
                                     ('props/Barrel_01', 7.6, iy0 + 0.8, 2.0, None), ('props/Box_02', 12.6, iy0 + 0.9, -0.2, 1.1),
                                     ('props/Bag_02', 9.2, iy0 + 1.0, 0.8, None), ('props/Bag_01', -10.2, iy0 + 1.1, 2.2, None)):
            prop(rel, x, y, FLA, rz, s=sc_, interior=True)
        col_box(0.0, iy0 + 0.68, FLA + 0.7, 14.0, 0.58, 0.7)      # the wares: clear of the auctioneer's spot
        # a weapon rack behind the east booth, a bow rack behind the west one
        for (x, face) in ((ix1 - 0.35, -1), (ix0 + 0.35, 1)):
            beam(furn, (x, -1.8, FLA + 1.9), (x, 2.2, FLA + 1.9), 0.12, 0.2)
            beam(furn, (x, -1.8, FLA + 0.5), (x, 2.2, FLA + 0.5), 0.12, 0.2)
            for (k, rel) in enumerate(('props/Weapon_01', 'props/Weapon_02', 'props/Weapon_03', 'props/Weapon_04', 'props/Weapon_01')):
                prop(rel, x + face * 0.18, -1.4 + k * 0.85, FLA + 1.05, math.pi / 2 * face, interior=True)
        # the auctioneers' spots, named for town_place.mjs (which seats the NPCs and
        # sets their facing: the back three face the door, the side two the hall)
        INFO_AH = dict(npcs=dict(zip(('auctioneer_w', 'auctioneer', 'auctioneer_e', 'auctioneer_wall_w',
                                      'auctioneer_wall_e'), SPOTS)))
        return dict(EAVE=Z1, z_ridge=z_ridge, reveal=dict(
            volumes=[dict(x0=rect[0] - 0.5, x1=rect[1] + 0.5, y0=0, y1=z_ridge + 5, z0=-(y1 + 0.3), z1=-(rect[2] - 0.5))]),
            npcs=INFO_AH['npcs'])

    # -------------------------------------------------------------------------
    #  THE CHURCH: a buttressed nave, a bell tower and spire, the chancel
    # -------------------------------------------------------------------------
    def church():
        W, D = 12.0, 22.0
        T = 0.8
        FLC = 0.9
        H0 = 8.4
        rect = (-W / 2, W / 2, -D / 2, D / 2)
        ix0, ix1, iy0, iy1 = rect[0] + T, rect[1] - T, rect[2] + T, rect[3] - T
        Z1 = FLC + H0
        shell = part('shell')
        plinth(shell, rect[0] - 0.05, rect[1] + 0.05, rect[2] - 0.05, rect[3] + 0.05, FLC, z_bot=-1.0, flare=0.4)
        dw = 3.2
        door = dict(s=W / 2, w=dw, z0=FLC, z1=FLC + 3.4, arch=True, kind='door')
        TS = 5.2
        TX, TY = rect[1] + TS / 2 - 0.35, rect[3] - TS / 2 + 0.6
        TOWER_Y0 = TY - TS / 2
        lanc = []
        for k in range(4):
            y = rect[2] + 3.2 + k * 4.8
            lanc.append(y)
        ops = {'n': [door],
               'e': [dict(s=y - rect[2], w=1.4, z0=FLC + 2.6, z1=FLC + 6.4, arch=True, kind='window', cell='lancet',
                          sub=(0.0, 0.0, 0.5, 1.0)) for y in lanc if y < TOWER_Y0 - 1.0],
               'w': [dict(s=rect[3] - y, w=1.4, z0=FLC + 2.6, z1=FLC + 6.4, arch=True, kind='window', cell='lancet',
                          sub=(0.5, 0.0, 1.0, 1.0)) for y in lanc],
               's': []}
        # the lancets take half the lancet cell each (two lancets per cell)
        storey_walls(shell, rect, FLC, Z1, 'stone', ops, t=T, inner_mat=M_PLASTER, lit=1.0, door_cell='door_oak')
        for side in 'nwse':
            gaps = [(door['s'] - dw / 2, door['s'] + dw / 2, FLC + 3.4 + dw / 2)] if side == 'n' else []
            side_wall_col(side, rect, T, 0.0, Z1, gaps)
        # buttresses between the lancets, stepped
        for side, xw in (('e', rect[1]), ('w', rect[0])):
            o = outward(side)
            for y in [rect[2] + 0.6] + [lanc[k] + 2.4 for k in range(3)] + [rect[3] - 0.6]:
                if side == 'e' and y > TOWER_Y0 - 0.8:
                    continue
                for (h, d, w) in ((Z1 - 2.6, 1.4, 1.1), (Z1 - 1.3, 0.8, 0.9)):
                    cuboid(shell, (xw + o[0] * d / 2, y, h / 2 - 0.5), (d, w, h + 1.0), M_STONE,
                           faces={'+x' if o[0] > 0 else '-x', '-y', '+y', '+z'})     # none against the wall
                    cuboid(shell, (xw + o[0] * (d / 2 + 0.05), y, h + 0.05), (d + 0.1, w + 0.1, 0.18), M_DRESSED,
                           faces={'-x', '+x', '-y', '+y', '+z'})
                col_box(xw + o[0] * 0.7, y, (Z1 - 1.5) / 2, 0.7, 0.55, (Z1 - 1.5) / 2)
        # the floor: flagstones, a raised chancel at the back
        floor_deck(shell, ix0, ix1, iy0 + 4.2, iy1, FLC, M_FLAG)
        floor_deck(shell, -dw / 2, dw / 2, iy1, rect[3] + 0.1, FLC, M_FLAG)
        CH = FLC + 0.6
        cuboid(shell, (0, iy0 + 1.6, CH / 2), (ix1 - ix0, 3.2, CH), M_DRESSED, faces={'+z', '+y'})
        floor_deck(shell, ix0, ix1, iy0, iy0 + 3.2, CH, M_FLAG)
        # two steps up to the chancel, full width
        for k, (y0s, y1s, zt) in enumerate(((iy0 + 3.7, iy0 + 4.2, FLC + 0.3), (iy0 + 3.2, iy0 + 3.7, CH))):
            cuboid(shell, (0, (y0s + y1s) / 2, zt / 2), (ix1 - ix0, y1s - y0s, zt), M_DRESSED, faces={'+z', '+y'})
        col_ramp(0, iy0 + 3.7, (ix1 - ix0) / 2, 0.5, CH, FLC, ry=math.pi / 2)
        # ---- inside: pews facing the altar, a runner, the altar, candles ------
        furn = part('furniture', grp='INT_L0')
        for k in range(5):
            y = iy0 + 6.2 + k * 2.4
            for sgn in (-1, 1):
                prop('props/Furniture_14', sgn * 3.1, y, FLC, 0.0, interior=True, s=1.3)
                col_box(sgn * 3.1, y, 0.45 + FLC / 2, 2.0, 0.45, 0.45 + FLC / 2)
        for k in range(4):
            prop('props/Carpet_03', 0.0, iy0 + 5.5 + k * 2.4, FLC + 0.01, math.pi / 2, s=1.6, interior=True)
        prop('props/Altar_02', 0.0, iy0 + 1.1, CH, 0.0, interior=True, s=2.0)
        col_box(0.0, iy0 + 1.1, CH + 1.3, 0.8, 0.7, 1.3)
        prop('props/Altar_01', -2.6, iy0 + 2.8, CH, math.pi / 5, interior=True)
        col_box(-2.6, iy0 + 2.8, CH + 1.2, 0.7, 0.7, 1.2)
        for (x, fid) in ((-1.8, 'altar_w'), (1.8, 'altar_e')):
            prop('props/Candle_05', x, iy0 + 1.1, CH, 0.0, interior=True)
            flame(fid, 'torch', x, iy0 + 1.1, CH + 2.4, 0.26)
        for (x, y) in ((ix0 + 0.6, iy1 - 1.4), (ix1 - 0.6, iy1 - 1.4)):
            prop('props/Candle_05', x, y, FLC, 0.0, interior=True)
        for y in lanc[1:3]:
            sconce(furn, ix0, y + 2.4, FLC + 4.2, (1, 0), fid=f'sconce_w{int(y)}')
            sconce(furn, ix1, y + 2.4, FLC + 4.2, (-1, 0), fid=f'sconce_e{int(y)}')
        for k in (1, 3):
            y = iy0 + 2.0 + k * (iy1 - iy0 - 4.0) / 4
            chandelier(furn, 0.0, y, Z1 + 1.0, r=1.2, fid=f'nave_{k}')
        # banners hung high on the back wall, the crest over the altar
        banner(furn, (-3.0, iy0 + 0.1, Z1 - 1.2), (1, 0, 0), (0, 1, 0), 2.0, 4.0, sway=0.08)
        banner(furn, (3.0, iy0 + 0.1, Z1 - 1.2), (1, 0, 0), (0, 1, 0), 2.0, 4.0, sway=0.08)
        # ---- the roof, open timber trusses inside ---------------------------------
        roofp = part('roof', grp='H2')
        z_ridge = gable_roof(roofp, 0, 0, D, W, Z1, 7.4, axis='y', eave_over=1.0, gable_over=0.6, flare=0.3,
                             sag=0.25, rows=14, gable_mat=M_STONE, gable_frame=False, gable_window=2.2,
                             finial_ends=(-1,))
        for k in range(5):
            y = iy0 + 2.0 + k * (iy1 - iy0 - 4.0) / 4
            beam(roofp, (ix0, y, Z1 - 0.2), (0, y, z_ridge - 0.6), 0.34, 0.34)
            beam(roofp, (ix1, y + 0.03, Z1 - 0.2), (0, y + 0.03, z_ridge - 0.6), 0.34, 0.34)   # the pair cross at the apex: never on one plane
            beam(roofp, (ix0 + 1.6, y, Z1 + 1.0), (ix1 - 1.6, y, Z1 + 1.0), 0.3, 0.3)
        # ---- the bell tower on the front-east corner -------------------------------
        tw = part('tower')
        TZ = Z1 + 5.0
        for (tx0, tx1, ty0, ty1) in ((TX - TS / 2, TX + TS / 2, TY - TS / 2, TY + TS / 2),):
            plinth(tw, tx0, tx1, ty0, ty1, FLC - 0.05, z_bot=-1.0, flare=0.4)    # under the nave's own plinth cap
            belfry = []
            for side in 'nwse':
                (ax, ay), (bx, by) = wall_ends(side, (tx0, tx1, ty0, ty1))
                ops = [dict(s=TS / 2, w=1.9, z0=TZ - 4.2, z1=TZ - 1.8, arch=True)]
                if side == 'e':
                    ops.append(dict(s=TS / 2, w=0.9, z0=FLC + 4.0, z1=FLC + 6.0, arch=True))
                L, u, n = wall(tw, ax, ay, bx, by, FLC - 0.02, TZ, M_STONE, ops, t=0.7, inner=True, inner_mat=M_DARK)
                A = Vector((ax, ay, 0))
                window_frame(tw, A, u, n, ops[0], sill=True, fw=0.2, proud=0.12)
                if side == 'e':
                    window_glass(tw, A, u, n, ops[1], 0.4, lit=True)
            for (cx, cy, sx, sy) in ((tx1, ty1, 1, 1), (tx0, ty1, -1, 1), (tx0, ty0, -1, -1), (tx1, ty0, 1, -1)):
                quoins(tw, cx, cy, FLC, TZ, sx, sy, size=1.0)
            cuboid(tw, (TX, TY, TZ + 0.2), (TS + 0.6, TS + 0.6, 0.4), M_DRESSED, faces={'-x', '+x', '-y', '+y', '-z', '+z'})
            cuboid(tw, (TX, TY, TZ - 4.6), (TS + 0.3, TS + 0.3, 0.3), M_DRESSED, faces={'-x', '+x', '-y', '+y', '-z', '+z'})
            # the bell, gold, in the belfry
            lathe(tw, [(0.0, 0.0), (0.9, 0.05), (0.8, 0.3), (0.55, 1.2), (0.35, 1.7), (0.0, 1.8)], (TX, TY, TZ - 3.6),
                  segs=12, mat=M_GOLD)
            beam(tw, (TX - TS / 2, TY, TZ - 1.6), (TX + TS / 2, TY, TZ - 1.6), 0.3, 0.3)
            col_box(TX, TY, TZ / 2, TS / 2 + 0.1, TS / 2 + 0.1, TZ / 2)
            # the spire: four-sided, bell-cast, gold finial and orb
            sp = part('spire', grp='H2')
            base = TZ + 0.4
            S2 = TS / 2 + 0.5
            apex = (TX, TY, base + 12.0)
            corners = [(TX - S2, TY - S2), (TX + S2, TY - S2), (TX + S2, TY + S2), (TX - S2, TY + S2)]
            NR = 8
            for i in range(4):
                a, b = corners[i], corners[(i + 1) % 4]
                for r in range(NR):
                    t0, t1 = r / NR, (r + 1) / NR
                    def pt(c, t):
                        k = _bell(t, 0.45)
                        return (c[0] + (apex[0] - c[0]) * t, c[1] + (apex[1] - c[1]) * t, base + (apex[2] - base) * k)
                    q = [pt(a, t0), pt(b, t0), pt(b, t1), pt(a, t1)]
                    quad(sp, q, M_ROOF, tint=(0.95 + 0.05 * (r % 2),) * 3)
            # its envelope for the LOD twin: each face in three bands of the same bell
            for i in range(4):
                a, b = corners[i], corners[(i + 1) % 4]
                ts_ = (0.0, 0.3, 0.65, 1.0)
                for r in range(3):
                    def ept(c, t):
                        k = _bell(t, 0.45)
                        return (c[0] + (apex[0] - c[0]) * t, c[1] + (apex[1] - c[1]) * t, base + (apex[2] - base) * k + 0.03)
                    mx, my = (a[0] + b[0]) / 2 - TX, (a[1] + b[1]) / 2 - TY
                    q = [ept(a, ts_[r]), ept(b, ts_[r]), ept(b, ts_[r + 1]), ept(a, ts_[r + 1])]
                    env_poly(sp, q[:3] if r == 2 else q, normal=(mx, my, 0.4))
            env_poly(sp, [(c[0], c[1], base) for c in corners], normal=(0, 0, -1))
            finial(sp, TX, TY, base + 11.8, h=3.0, r=0.3)
            col_box(TX, TY, base + 3.0, S2 * 0.7, S2 * 0.7, 3.0)
        # ---- the street front: steps, lanterns, the priest's board -------------------
        ent = part('entry')
        steps(ent, 0.0, rect[3] + 0.1, (0, 1), dw + 1.2, FLC, n_steps=3)
        for sgn in (-1, 1):
            wall_lantern(ent, sgn * (dw / 2 + 1.0), rect[3] + 0.05, FLC + 3.6, (0, 1))
        prop('props/NoticeBoard_01', -4.2, rect[3] + 0.8, 0.0, math.pi, name='notices')
        col_box(-4.2, rect[3] + 0.8, 1.7, 0.9, 0.3, 1.7)
        return dict(EAVE=Z1, z_ridge=z_ridge, reveal=dict(
            volumes=[dict(x0=rect[0] - 0.3, x1=rect[1] + 0.3, y0=0, y1=z_ridge, z0=-(rect[3] + 0.3), z1=-(rect[2] - 0.3))]),
            npcs={'priest': (0.0, iy0 + 4.6)})

    # -------------------------------------------------------------------------
    #  SHOPS: a townhouse with a shopfront, an awning and goods on the street
    # -------------------------------------------------------------------------
    def shop(kind):
        """A townhouse shop (SPACEY, 2026-09-26: "these 2 shops need interiors so
        you can buy stuff there", "make the signs on the right side of the
        door", the street stalls "floating ... some1 could fit behind"): an
        ENTERABLE ground floor with a counter, shelves of goods and the
        shopkeeper's seat; a stall on the street under an awning on posts;
        the hanging sign to the right of the door as you face it."""
        spec = dict(
            a=dict(W=11.0, D=8.4, enterable=True,
                   storeys=[dict(h=4.2, style='stone', win=dict(n=[3.1], s=0, e=1, w=1), shutters='oak'),
                            dict(h=3.6, style='plaster', jetty='n', win=dict(n=3, s=2, e=1, w=1), boxes=True)],
                   door=dict(side='n', at=-1.6, lantern=0, cell='door_oak'),
                   roof=dict(axis='x', rise=5.2, cross=[dict(x=2.0, w=4.6, rise=3.7, window=0.85)]),
                   chimneys=[dict(kind='stack', x=-3.0, y=-1.6)],
                   awning_spans=[('n', 0.3, 4.45)],
                   sign=dict(side='n', at=-3.5, cell='sign_sack', z=FL + 3.7, door_side=1)),
            b=dict(W=9.4, D=9.0, enterable=True,
                   storeys=[dict(h=4.2, style='stone', win=dict(n=[1.75], s=0, e=2, w=1), shutters='blue', ww=1.0),
                            dict(h=3.4, style='plaster', jetty='w', jo=0.55, win=dict(n=2, s=1, e=2, w=1), boxes=True)],
                   door=dict(side='n', at=-0.7, lantern=0, cell='door_teal'),
                   roof=dict(axis='y', rise=5.8),
                   turret=dict(corner='ne', r=1.4, top=10.6, stone_h=4.6, cone=5.4),
                   chimneys=[dict(kind='breast', side='w', at=-2.0)],
                   awning_spans=[('n', 0.95, 2.6)],
                   sign=dict(side='n', at=-2.6, cell='sign_potion', z=FL + 3.7, door_side=1)),
        )[kind]
        info = house(spec)
        W, D = spec['W'], spec['D']
        y1 = D / 2
        T_ = 0.45
        ix0, ix1, iy0, iy1 = -W / 2 + T_, W / 2 - T_, -D / 2 + T_, D / 2 - T_
        Z1 = FL + spec['storeys'][0]['h']
        # ---- the street stall (to the left of the door as you face it) --------
        aw = part('stall')
        if kind == 'a':
            sx0, sx1 = 0.3, 4.45
            cx0, cx1, cy0, cy1, zt = street_stall(aw, sx0, sx1, y1, awning_z=FL + 3.35, front_z=FL + 2.5,
                                                   cell='sign_sack',
                                                   tints=((1.0, 0.97, 0.9), (0.85, 0.3, 0.26)))
            goods = [('props/Food_04', 0.0), ('props/Food_02', 0.12), ('props/Food_08', 0.0), ('props/Food_05', 0.08),
                     ('props/Food_04', 0.0), ('props/Food_01', 0.0)]
            for i, (g, dz) in enumerate(goods):
                prop(g, cx0 + 0.35 + (cx1 - cx0 - 0.7) * i / (len(goods) - 1), (cy0 + cy1) / 2 + (0.1 if i % 2 else -0.08),
                     zt + 0.01, RNG.random() * 3)
            prop('props/Bag_03', cx0 + 0.45, (cy0 + cy1) / 2, 0.36, 0.4, s=0.75)          # on the lower shelf
            prop('props/Box_01', cx1 - 0.55, (cy0 + cy1) / 2, 0.36, 0.1, s=0.8)
            prop('props/Barrel_02', sx1 + 0.55, y1 + 1.1, 0.0, 0.3)
            col_box(sx1 + 0.55, y1 + 1.1, 0.7, 0.62, 0.62, 0.7)
            prop('props/Bag_01', sx1 + 0.5, y1 + 2.2, 0.0, 1.2, s=1.3)
            col_box(sx1 + 0.5, y1 + 2.2, 0.45, 0.45, 0.45, 0.45)
        else:
            sx0, sx1 = 0.95, 2.6
            cx0, cx1, cy0, cy1, zt = street_stall(aw, sx0, sx1, y1, awning_z=FL + 3.35, front_z=FL + 2.5,
                                                   cell='sign_potion',
                                                   tints=((1.0, 1.0, 1.0), (0.35, 0.45, 0.9)))
            goods = ['props/Potion_01', 'props/Potion_04', 'props/Potion_07', 'props/Potion_02', 'props/Bottle_04']
            for i, g in enumerate(goods):
                prop(g, cx0 + 0.2 + (cx1 - cx0 - 0.4) * i / (len(goods) - 1), (cy0 + cy1) / 2 + (0.12 if i % 2 else -0.1),
                     zt + 0.01, RNG.random() * 3)
            prop('props/Box_01', (cx0 + cx1) / 2, (cy0 + cy1) / 2, 0.36, 0.2, s=0.7)
        # ---- the shop floor ----------------------------------------------------
        furn = part('furniture', grp='INT_L0')
        yc = -0.8                                      # the counter's customer face
        if kind == 'a':
            # a general store: sacks, crates, barrels, jars and loaves
            c0, c1 = -3.0, 2.2
            ztop = shop_counter(furn, c0, c1, yc, FL)
            for (g, x, dy, sc_) in (('props/Food_04', -2.4, 0.0, None), ('props/Cup_01', -1.7, 0.1, None),
                                    ('props/Book_03', -0.9, -0.05, 0.9), ('props/Candle_03', 0.5, 0.0, 0.9),
                                    ('props/Food_08', 1.4, 0.05, None), ('props/PlateFood_01', 1.85, -0.1, None)):
                prop(g, x, yc - 0.4 + dy, ztop, RNG.random() * 3, s=sc_, interior=True)
            shelves = wall_shelves(furn, -3.9, 3.9, iy0, FL)
            # scaled to clear the board above (0.54 yd between shelves)
            row = [('props/Bag_02', 0.42), ('props/Box_01', 0.55), ('props/Food_04', None), ('props/Bottle_01', 1.4),
                   ('props/Food_08', None), ('props/Bag_03', 0.42), ('props/Cup_01', None), ('props/Food_04', None),
                   ('props/Box_01', 0.55), ('props/Bottle_04', 1.4)]
            for li, (z, ysh) in enumerate(shelves):
                n_ = 15
                for i in range(n_):
                    g, sc_ = row[(i * 3 + li * 5 + RNG.randint(0, 2)) % len(row)]
                    prop(g, -3.6 + 7.2 * i / (n_ - 1) + RNG.uniform(-0.07, 0.07), ysh + RNG.uniform(-0.06, 0.04), z,
                         RNG.random() * 3, s=sc_, interior=True)
            for (bx, by) in ((ix1 - 0.8, 2.6), (ix1 - 0.8, 1.2)):
                prop('props/Barrel_01', bx, by, FL, RNG.random(), interior=True)
                col_box(bx, by, FL + 0.7, 0.62, 0.62, 0.7)
            prop('props/Bag_02', ix1 - 0.7, -0.3, FL, 0.6, interior=True)
            prop('props/Bag_01', ix1 - 1.5, 2.1, FL, 1.9, s=1.4, interior=True)
            col_box(ix1 - 0.9, 0.9, FL + 0.6, 0.8, 2.2, 0.6)
            prop('props/Box_02', ix0 + 0.8, iy1 - 0.85, FL, 0.1, s=1.1, interior=True)
            prop('props/Box_01', ix0 + 0.8, iy1 - 0.85, FL + 0.9, 0.5, s=1.0, interior=True)
            col_box(ix0 + 0.8, iy1 - 0.85, FL + 0.75, 0.62, 0.62, 0.75)
            prop('props/Carpet_05', -0.4, 1.4, FL + 0.005, 0.0, interior=True)
            chandelier(furn, -0.4, 1.3, Z1 - 0.02, r=0.7, fid='shop_a_lamp')
            keeper = (-0.4, yc - 1.6)
        else:
            # an apothecary: potions, bottles, books, a cauldron
            c0, c1 = -2.8, 1.4
            ztop = shop_counter(furn, c0, c1, yc, FL)
            for (g, x, dy, sc_) in (('props/Potion_02', -2.3, 0.0, None), ('props/Book_02', -1.4, -0.05, 0.9),
                                    ('props/Potion_04', -0.5, 0.1, None), ('props/Candle_03', 0.3, 0.0, 0.9),
                                    ('props/Potion_07', 1.0, -0.05, None)):
                prop(g, x, yc - 0.4 + dy, ztop, RNG.random() * 3, s=sc_, interior=True)
            shelves = wall_shelves(furn, -3.6, 2.4, iy0, FL)
            row = [('props/Potion_01', None), ('props/Potion_04', None), ('props/Bottle_01', 1.4),
                   ('props/Potion_07', None), ('props/Book_03', 0.85), ('props/Potion_02', None),
                   ('props/Bottle_04', 1.4), ('props/Potion_04', None)]
            for li, (z, ysh) in enumerate(shelves):
                n_ = 14
                for i in range(n_):
                    g, sc_ = row[(i * 3 + li * 5 + RNG.randint(0, 2)) % len(row)]
                    prop(g, -3.35 + 5.5 * i / (n_ - 1) + RNG.uniform(-0.05, 0.05), ysh + RNG.uniform(-0.06, 0.04), z,
                         RNG.random() * 3, s=sc_, interior=True)
            # the cauldron over a bed of embers in the west corner by the door
            prop('props/Pot_02', ix0 + 0.95, iy1 - 1.2, FL + 0.05, 0.5, interior=True)
            cuboid(furn, (ix0 + 0.95, iy1 - 1.2, FL + 0.04), (1.3, 1.3, 0.08), M_DRESSED, faces={'-x', '+x', '-y', '+y', '+z'})
            col_box(ix0 + 0.95, iy1 - 1.2, FL + 0.45, 0.7, 0.7, 0.45)
            flame('shop_b_embers', 'embers', ix0 + 0.95, iy1 - 1.2, FL + 0.2, 0.35)
            prop('props/Furniture_08', ix1 - 0.45, -1.4, FL, -math.pi / 2, interior=True)
            prop('props/Book_03', ix1 - 0.45, -1.4, FL + 0.8, 0.3, s=0.8, interior=True)
            col_box(ix1 - 0.45, -1.4, FL + 0.45, 0.4, 0.5, 0.45)
            prop('props/Candle_05', 2.3, yc - 0.3, FL, 0.0, s=1.4, interior=True)
            col_box(2.3, yc - 0.3, FL + 1.0, 0.25, 0.25, 1.0)
            prop('props/Carpet_03', -0.7, 1.5, FL + 0.005, 0.0, interior=True)
            chandelier(furn, -0.7, 1.4, Z1 - 0.02, r=0.65, fid='shop_b_lamp')
            keeper = (-0.7, yc - 1.6)
        rh = info['z_ridge']
        top = info['top_rect']
        INFO['shop_' + kind] = dict(
            reveal=dict(volumes=[dict(x0=round(top[0] - 0.3, 2), x1=round(top[1] + 0.3, 2), y0=0, y1=round(rh, 2),
                                      z0=round(-(top[3] + 0.3), 2), z1=round(-(top[2] - 0.3), 2))],
                        storeySplit=round(Z1 - 0.15, 2)),
            npcs={'shopkeeper': keeper})
        return kind

    # -------------------------------------------------------------------------
    #  THE BANK: the Deepglass Vault (Tide's Coffer), rebuilt in the town kit
    # -------------------------------------------------------------------------
    def bank():
        """The Deepglass Vault (SPACEY, 2026-09-26: rebuild the old kit bank "using
        the same style and complexity of the new buildings"): a tall stone
        banking storey under a jettied timber storey, a front cross gable with
        a rose window, a corner turret, a hooded door with lanterns and the
        coin sign to its right; inside, a teller counter behind an iron grille
        with three open windows, a round vault door, strongboxes, coin piles
        and ledgers behind it, pews and banners for the customers, two stone
        pillars, chandeliers. The Coffer-Keeper stands at the middle window."""
        spec = dict(W=18.0, D=12.5, enterable=True,
                    storeys=[dict(h=5.4, style='stone', win=dict(n=[-6.2, -3.8, 3.8, 6.2], s=0, e=2, w=2),
                                  shutters='oak', ww=1.3),
                             dict(h=3.8, style='plaster', jetty='ew', jo=0.6, win=dict(n=5, s=4, e=2, w=2), boxes=True)],
                    door=dict(side='n', at=0.0, w=2.6, h=3.1, lantern=1.9, cell='door_oak', hood=True),
                    roof=dict(axis='x', rise=6.0, cross=[dict(x=0.0, w=6.6, rise=4.6, window=1.05)],
                              dormers=[dict(x=-5.2, side='s', in_=1.8), dict(x=5.2, side='s', in_=1.8)]),
                    chimneys=[dict(kind='stack', x=-6.0, y=-2.2), dict(kind='stack', x=6.4, y=1.8)],
                    turret=dict(corner='nw', r=1.7, top=13.4, stone_h=5.9, cone=6.4),
                    sign=dict(side='n', at=-2.4, cell='sign_coin', z=FL + 4.1, door_side=1, size=1.4),
                    # the vault doorway in the back wall (the door fills it, below)
                    extra_ops=[dict(storey=0, side='s', at=0.0, w=3.04, z0=FL - 0.02, z1=FL + 3.62)])
        info = house(spec)
        W, D = spec['W'], spec['D']
        T_ = 0.45
        ix0, ix1, iy0, iy1 = -W / 2 + T_, W / 2 - T_, -D / 2 + T_, D / 2 - T_
        Z1 = FL + spec['storeys'][0]['h']
        furn = part('furniture', grp='INT_L0')
        up = Vector((0, 0, 1))
        # ---- the teller counter and its grille -----------------------------------
        yc = -1.2
        c0, c1 = -6.2, 6.2
        ztop = shop_counter(furn, c0, c1, yc, FL, depth=0.9, h=1.15)
        windows = (-4.0, 0.0, 4.0)
        z_bar0, z_bar1 = ztop, FL + 3.3
        # posts, top rail and a gold crest rail
        for x in (c0 + 0.1, c1 - 0.1) + tuple(w + sgn * 0.62 for w in windows for sgn in (-1, 1)):
            cuboid(furn, (x, yc - 0.45, (z_bar0 + z_bar1) / 2), (0.14, 0.14, z_bar1 - z_bar0), M_TIMBER)
        beam(furn, (c0, yc - 0.45, z_bar1 + 0.08), (c1, yc - 0.45, z_bar1 + 0.08), 0.18, 0.16)
        beam(furn, (c0, yc - 0.45 + 0.02, z_bar1 - 0.22), (c1, yc - 0.45 + 0.02, z_bar1 - 0.22), 0.06, 0.1, mat=M_GOLD)
        bx = c0 + 0.3
        while bx < c1 - 0.25:
            if all(abs(bx - w) > 0.6 for w in windows):
                beam(furn, (bx, yc - 0.45, z_bar0), (bx, yc - 0.45, z_bar1), 0.045, 0.045, mat=M_IRON)
            bx += 0.19
        for w in windows:
            # the teller window: an arched oak frame, a brass ledge
            beam(furn, (w - 0.55, yc - 0.45, z_bar0 + 1.25), (w + 0.55, yc - 0.45, z_bar0 + 1.25), 0.12, 0.16)
            cuboid(furn, (w, yc - 0.1, ztop + 0.03), (1.0, 0.3, 0.05), M_GOLD, tint=(0.8, 0.7, 0.5))
        col_box(0.0, yc - 0.45, (FL + z_bar1) / 2, (c1 - c0) / 2 + 0.1, 0.55, (z_bar1 - FL) / 2)
        # coins and ledgers on the counter
        def coin_pile(x, y, z, n=5, r=0.14):
            coin_stack(furn, x, y, z, n=n, r=r)             # one piece a stack (SPACEY: "simifly ... the stacks")
        for w in windows:
            coin_pile(w - 0.3, yc - 0.3, ztop, n=RNG.randint(3, 6))
            prop('props/Book_03', w + 0.35, yc - 0.3, ztop, RNG.random() * 3, s=0.8, interior=True)
        # ---- the vault: a massive bronze door in the back wall, the strongroom ------
        # (SPACEY, 2026-09-26: "have a massive vault door in the building that opens
        # when you click on it" / "something like the wow 1 but mix up the design
        # and make it look super aaa"). The door swings INTO the hall on its
        # hinges (render/placed_movers.ts); the doorway itself stays blocked:
        # the hoard is for looking at. (2026-09-27: the brass rope round the
        # swing and the two ledger desks either side came out - "remove these
        # rail blocking the vault and remove the 2 small tables".)
        VW, VH = 2.8, 3.5
        vault = part('vault', grp='INT_L0')
        vault_door(vault, 0.0, iy0 - 0.04, FL, W=VW, H=VH, face=1, hs=1)     # hinges on the left as you face it
        col_box(0.0, iy0 - 0.24, FL + VH / 2, 1.55, 0.26, VH / 2 + 0.2)          # the doorway, open or shut
        # the strongroom: a stone annex off the back wall, slate-roofed, the hoard
        # lit by a candle wheel (its walls, floor and ceiling ship with the shell)
        sr = part('strongroom')
        ax0, ax1, ay0, ay1 = -2.9, 2.9, -D / 2 - 3.9, -D / 2
        tS = 0.55
        zt = FL + 4.3
        cs = [(ax0, ay1), (ax0, ay0), (ax1, ay0), (ax1, ay1)]
        for i in range(3):
            (xa, ya), (xb, yb) = cs[i], cs[i + 1]
            wall(sr, xa, ya, xb, yb, -0.02, zt, M_STONE, (), t=tS, inner=True, inner_mat=M_STONE)
        plinth(sr, ax0 - 0.05, ax1 + 0.05, ay0 - 0.05, ay1 + 0.3, FL, cap=False)
        for (qx, qy, sx_, sy_) in ((ax0, ay0, -1, -1), (ax1, ay0, 1, -1)):
            quoins(sr, qx, qy, FL, zt, sx_, sy_, size=0.8)
        course_band(sr, (ax0, ax1, ay0, ay1 + 0.2), zt - 0.1)
        floor_deck(sr, ax0 + tS, ax1 - tS, ay0 + tS, iy0, FL, M_FLAG)
        ceiling(sr, ax0 + tS, ax1 - tS, ay0 + tS, ay1, zt - 0.32, joist_axis='x')
        col_wall(ax0 + tS / 2, ay1, ax0 + tS / 2, ay0, 0.0, zt, tS)
        col_wall(ax0, ay0 + tS / 2, ax1, ay0 + tS / 2, 0.0, zt, tS)
        col_wall(ax1 - tS / 2, ay0, ax1 - tS / 2, ay1, 0.0, zt, tS)
        srr = part('strongroom_roof', grp='H2')
        gable_roof(srr, 0.0, (ay0 + ay1) / 2, ay1 - ay0, ax1 - ax0, zt, 1.3, axis='y', eave_over=0.4,
                   gable_over=0.3, flare=0.3, sag=0.06, rows=6, thick=0.24, closed_ends=(-1,), finial_ends=(-1,),
                   gable_mat=M_STONE, gable_frame=False)
        col_box(0.0, (ay0 + ay1) / 2, zt + 0.6, 3.3, (ay1 - ay0) / 2 + 0.3, 0.6)
        hoard = part('hoard', grp='INT_L0')
        hx0, hx1, hy0 = ax0 + tS, ax1 - tS, ay0 + tS
        for x in (-1.45, 0.0, 1.45):                  # three ingot pyramids on stone plinths at the back
            cuboid(hoard, (x, hy0 + 0.45, FL + 0.15), (1.1, 0.8, 0.3), M_DRESSED, faces={'-x', '+x', '-y', '+y', '+z'})
            ingot_stack(hoard, x, hy0 + 0.45, FL + 0.3, rows=4 if x == 0.0 else 3, rz=0.0)
        # (a chest is 1.76 x 1.1 at kit scale: one down each side wall, clear of
        # the back plinths and the doorway - SPACEY, 2026-09-26: "fix these chests")
        for (x, rz) in ((hx0 + 0.58, -math.pi / 2), (hx1 - 0.58, math.pi / 2)):
            prop('props/Chest_01', x, -7.6, FL, rz, interior=True)
        # a heap of loose coin in the middle (coins only: SPACEY, 2026-09-26), a
        # few stacks strewn round it
        coin_heap(hoard, 0.0, -7.7, FL, R=0.95, H=0.5, n=170)
        for (x, y) in ((-0.95, -8.5), (1.0, -7.0), (-0.9, -6.75)):
            coin_pile(x, y, FL, n=RNG.randint(3, 5), r=0.12)
        ingot_stack(hoard, 0.95, -6.5, FL, rows=2, rz=0.4)
        chandelier(hoard, 0.0, hy0 + 1.6, zt - 0.34, r=0.6, fid='bank_vault')
        # strongboxes along the back wall either side, clear of the rope and of
        # each other (a chest is 1.76 long at kit scale: 2 yd apart)
        # (SPACEY: "acutally all 4 are cooked": at 0.8 they read as strongboxes,
        # 1.4 x 0.9, lids at 0.53; the coin sits ON the lid's crown)
        for (x, rz) in ((-3.45, 0.04), (-5.45, -0.03), (3.65, -0.04), (5.65, 0.03)):
            prop('props/Chest_01', x, iy0 + 0.6, FL, math.pi + rz, s=PROP_S * 0.8, interior=True)
            col_box(x, iy0 + 0.6, FL + 0.28, 0.74, 0.48, 0.28)
            coin_pile(x + 0.15, iy0 + 0.62, FL + 0.52, n=RNG.randint(2, 4))
        # ---- the customers' hall ------------------------------------------------------
        for (x, y) in ((-4.6, 2.2), (4.6, 2.2)):
            # stone pillars to the ceiling: a base, a shaft, a capital
            lathe(furn, [(0.55, FL), (0.55, FL + 0.3), (0.42, FL + 0.42), (0.36, FL + 0.5), (0.34, Z1 - 0.7),
                         (0.42, Z1 - 0.55), (0.55, Z1 - 0.35), (0.55, Z1 - 0.03)], (x, y, 0.0), segs=10, mat=M_DRESSED,
                  cap_top=False)
            col_box(x, y, (FL + Z1) / 2, 0.5, 0.5, (Z1 - FL) / 2)
        for sgn in (-1, 1):
            prop('props/Furniture_14', sgn * (ix1 - 0.55), 2.4, FL, -sgn * math.pi / 2, s=1.5, interior=True)
            col_box(sgn * (ix1 - 0.55), 2.4, FL + 0.45, 0.45, 1.8, 0.45)
            banner(furn, (sgn * (ix1 - 0.02), -0.2, Z1 - 0.6), (0, -sgn, 0), (-sgn, 0, 0), 1.8, 3.2, sway=0.08)
        prop('props/Carpet_02', 0.0, 2.9, FL + 0.005, 0.0, s=2.0, interior=True)
        prop('props/NoticeBoard_01', -2.6, iy1 - 0.45, FL, 0.0, s=1.3, interior=True)
        col_box(-2.6, iy1 - 0.45, FL + 1.0, 0.9, 0.3, 1.0)
        chandelier(furn, -3.0, 2.2, Z1 - 0.02, r=0.8, fid='bank_lamp_w')
        chandelier(furn, 3.0, 2.2, Z1 - 0.02, r=0.8, fid='bank_lamp_e')
        rh = info['z_ridge']
        top = info['top_rect']
        INFO['bank'] = dict(
            reveal=dict(volumes=[dict(x0=round(top[0] - 0.3, 2), x1=round(top[1] + 0.3, 2), y0=0, y1=round(rh, 2),
                                      z0=round(-(top[3] + 0.3), 2), z1=round(-(top[2] - 0.3), 2))],
                        storeySplit=round(Z1 - 0.15, 2)),
            npcs={'banker': (0.0, yc - 1.35)})           # between the counter and the vault's rope
        return 'bank'

    BUILDERS['smithy'] = lambda: (INFO.__setitem__('smithy', smithy()), 'smithy')[1]
    BUILDERS['market'] = lambda: (INFO.__setitem__('market', auction_house()), 'market')[1]   # the auction house
    BUILDERS['hall'] = lambda: (INFO.__setitem__('hall', church()), 'hall')[1]
    BUILDERS['bank'] = bank
    BUILDERS['shop_a'] = lambda: (shop('a'), 'shop_a')[1]
    BUILDERS['shop_b'] = lambda: (shop('b'), 'shop_b')[1]


    # =========================================================================
    def clear_scene():
        for o in list(bpy.data.objects):
            if o.name.startswith('town_') or '__' in o.name or o.type == 'MESH':
                bpy.data.objects.remove(o, do_unlink=True)
        for me in list(bpy.data.meshes):
            if me.users == 0:
                bpy.data.meshes.remove(me)

    def measure(objs):
        lo = [1e9] * 3
        hi = [-1e9] * 3
        for o in objs:
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                for i in range(3):
                    lo[i] = min(lo[i], w[i])
                    hi[i] = max(hi[i], w[i])
        return lo, hi

    def gui_setup():
        sc = bpy.context.scene
        if not bpy.data.objects.get('town_sun'):
            ld = bpy.data.lights.new('town_sun', 'SUN')
            ld.energy = 3.0
            sun = bpy.data.objects.new('town_sun', ld)
            sun.rotation_euler = (math.radians(50), 0, math.radians(35))
            sc.collection.objects.link(sun)
        for win in bpy.context.window_manager.windows:
            for area in win.screen.areas:
                if area.type == 'VIEW_3D':
                    sp = area.spaces.active
                    sp.shading.type = 'MATERIAL'
                    sp.overlay.show_floor = True

    def gui_frame(center, dist, yaw_deg=35, pitch_deg=18):
        from mathutils import Quaternion, Euler
        for win in bpy.context.window_manager.windows:
            for area in win.screen.areas:
                if area.type == 'VIEW_3D':
                    r3d = area.spaces.active.region_3d
                    r3d.view_location = Vector(center)
                    r3d.view_distance = dist
                    r3d.view_rotation = Euler((math.radians(90 - pitch_deg), 0, math.radians(yaw_deg)), 'XYZ').to_quaternion()
                    area.tag_redraw()

    mats = town_mats()
    if GUI:
        clear_scene()
        gui_setup()
    gx = 0.0
    SMART_ON = os.environ.get('TOWN_SMART', '1') != '0' and TEX_SET != 'v1'
    for key in WANT:
        if key not in BUILDERS:
            log('unknown piece', key)
            continue
        if DO_EXPORT:
            # one building in the scene at a time: the smart bake's occlusion
            # must not see the last building (they share the origin here)
            for o in list(bpy.context.scene.objects):
                if o.type in ('MESH', 'EMPTY'):
                    bpy.data.objects.remove(o, do_unlink=True)
        reset_build()
        ROSE['cell'] = 'rose_' + key if 'rose_' + key in CELL else 'rose'   # each building its own rose
        tag = BUILDERS[key]()
        place_signs()             # last: clear of every awning, porch, prop and planter
        nfit = fit_furniture_boxes()
        if nfit:
            log(f'  {tag}: {nfit} furniture boxes fitted to their props')
        objs = build_objects(mats, tag)
        props = [p[0] for p in PROPS]
        lo, hi = measure(objs + props)
        size = (hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1])     # glTF frame
        log(f"{tag}: tris={tris_of(objs + props)} size=({size[0]:.2f},{size[1]:.2f},{size[2]:.2f}) "
            f"minZ={lo[2]:.3f} boxes={len(COLL['boxes'])} ramps={len(COLL['ramps'])}")
        if GUI:
            # LOD_PREVIEW: the twin baked (before anything moves: the envelope is
            # in the building's frame) and set beside it for a side-by-side
            tw = None
            if globals().get('LOD_PREVIEW'):
                if SMART_ON:
                    smart_bake(tag, objs + props, size=512, samples=8)
                tw = lod_bake(tag, objs, keep=True)
            for o in objs + props + [f[0] for f in FLOWERS]:
                o.location.x += gx
            gx += (hi[0] - lo[0]) + 6.0
            if tw is not None:
                tw.location.x += gx
                gx += (hi[0] - lo[0]) + 6.0
        if DO_EXPORT:
            # fire emitters as placement fireEffects offsets (glTF frame, y up
            # from the model's LOWEST point: the loader seats that on the ground)
            extra = {'flames': [{'id': fid, 'style': st, 'x': r4(x), 'y': r4(z - lo[2]), 'z': r4(-y), 'scale': sc}
                                for (fid, st, x, y, z, sc) in FLAMES]}
            inf = INFO.get(key) or {}
            if inf.get('reveal'):
                extra['reveal'] = inf['reveal']
            if inf.get('npcs'):
                extra['npcs'] = {k_: [r4(v[0]), r4(-v[1])] for k_, v in inf['npcs'].items()}   # glTF (x, z)
            write_sidecar(OUT, 'tidehold_' + tag, size, lo[2], extra)
            if SMART_ON:
                smart_bake(tag, objs + props, size=1024, samples=int(os.environ.get('TOWN_SMART_SAMPLES', '32')), out_dir=OUT)
                log('  smart mask baked', tag)
            # the LOD twin, baked from the finished exterior (before the export
            # joins the parts away)
            lod_bake(tag, objs, out_dir=OUT)
            export_town(tag, objs, PROPS, OUT, no_int=(tag == 'market'))
            log('  exported', tag)
    if GUI:
        gui_frame((gx / 2 - 3, 0, 4.5), max(28, gx * 1.1))
    LOG.append('done')
except Exception:
    LOG.append(traceback.format_exc())
print('\n'.join(LOG))
