# The Deepglass arena, as a placeable KIT: the spectator bowl, its gate, its
# floor, and the gold frame the glass bell hangs in.
#
# v1 (2026-09-21) turned the procedural bowl into sixteen editable wedges.
# v2 (2026-09-25, SPACEY: "the entrance is blocked and doesnt make alot of
# sense make it way more epic and the glass center bit way more epic and
# fitting for the rest of the city with the gold trim and glowing blue walls
# ... insure all of the collision fits neatly the textures look slick"):
#   - TILING textures (arena_tex/), not one baked atlas per 39-yd wedge: every
#     face carries world-yard UVs, so the stone is ~170 px a yard everywhere.
#   - The Tidehold vocabulary: gold trim and glowing cyan rune light on the
#     city's ashlar, and the city's blue shingle on the roofs.
#   - A new GATEHOUSE: the bridge deck arrives at y 6, so the gate is an
#     arrival terrace, an open great arch and a vaulted hall at that height,
#     then a grand stair down into the bowl between two seating blocks. v1's
#     arch was walled over (its openings were not sorted, so the wall-span
#     builder closed the arch) and a separate stair flight climbed into it.
#   - A new FLOOR (arena_floor x16 + arena_floor_core): one continuous paved
#     surface at y 0.40 from the bell's axis to the stands, replacing the
#     procedural plaza disc, the sunken terrain ring round it and the
#     concourse wedges.
#   - bell_frame: the gold collar, ribs and crowned crystal the glass bell
#     hangs in (render dressing, loaded by src/render/deepglass_kit.ts).
# v3 (same day, after a review pass):
#   - SEAT COLLISION follows the ring: every wedge's rake is three rotated
#     slice decks per run of rows (v1/v2 used straight boxes along the centre
#     line, so a body at a wedge seam sat a yard inside the seats), a gangway
#     deck a riser above, flat landings; feet ride the middle of each tread.
#   - Rune TRACERY (thin lit lines over dark sea-slate) instead of flat cyan
#     cards; gold that reads as metal (brushed normal, wide range, a warm
#     emissive floor); dressed limestone rows with Tidehold-blue seats; a
#     painted slate for the roofs; cylindrical UVs on every turned part.
#   - The gate gains flanking towers, big beacons, banners, a landing on the
#     stair, traced blind arches, a runner down the axis; the floor gains a
#     real tide channel with gold kerbs and a bridge on the processional; the
#     bell frame gains latitude rings, tapered ribs and a crown to match it.
#
# Authored Z-up in YARDS. A wedge piece's origin sits at its own footprint
# centre on the centre line with +X OUTWARD, so a placement is
# centre + Rmid*(cos t, sin t) with rotY = -t (scripts/.../place_arena.mjs).
#
#   PIECES='stand,vom,...'   which pieces to build (default: all)
#   ARENA_EXPORT=1           write GLBs + collision sidecars
#   ARENA_PREVIEW=name,...   Cycles camera shots (see SHOTS at the bottom)
#   ARENA_OUT=<dir>          output dir (default tmp/asset_src/deepglass)
#
# Headless (glTF export over the MCP bridge crashes Blender 5.1):
#   ARENA_EXPORT=1 /Applications/Blender.app/Contents/MacOS/Blender -b \
#     --python scripts/assets/deepglass/bl_dg_arena.py
import traceback
LOG = []
try:
    import os
    import sys
    import json
    import math
    _argv = sys.argv
    _py = _argv[_argv.index('--python') + 1] if '--python' in _argv else ''
    ROOT = (os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(_py)), '..', '..', '..'))
            if _py else os.environ['WOC_REPO'])  # no --python (text-block or bridge exec): set WOC_REPO
    exec(open(ROOT + "/scripts/assets/deepglass/dg_lib.py").read())
    OUT_DIR = os.environ.get('ARENA_OUT') or (ROOT + "/tmp/asset_src/deepglass")
    os.makedirs(OUT_DIR, exist_ok=True)
    TEXDIR = ROOT + "/scripts/assets/deepglass/arena_tex"
    # before the materials: reset_scene() sweeps every material with no users
    reset_scene()

    ALL = ('stand,vom,gatehouse,canopy,floor,floor_gate,floor_core,bell_frame,'
           'brazier,banner,box,scoreboard,pennant')
    WANT = set((os.environ.get('PIECES') or ALL).split(','))
    DO_EXPORT = bool(os.environ.get('ARENA_EXPORT'))
    PREVIEW = [s for s in (os.environ.get('ARENA_PREVIEW') or '').split(',') if s]

    # ---- the numbers the game already uses (src/sim/deepglass/layout.ts) ----
    R_BELL = 49.4          # DEEPGLASS_RADIUS  (38 * DG_ARENA_SCALE)
    R_IN = 63.4            # DG_BOWL_INNER_R   (R_BELL + 14)
    R_OUT = 99.4           # DG_BOWL_OUTER_R   (R_BELL + 50)
    TOP_Y = 27.0           # DG_BOWL_TOP_Y
    BELL_CY = 52.4         # DEEPGLASS_CENTER.y (DEEPGLASS_BASE_Y 3 + R_BELL)
    CRADLE_R = 26.0        # DEEPGLASS_CRADLE_R
    WEDGES = 16
    WSPAN = TAU / WEDGES   # 22.5 degrees
    HA = WSPAN / 2.0
    RMID = (R_IN + R_OUT) / 2.0          # 81.4 - every bowl wedge's own origin
    FLOOR = 0.40           # the arena floor's top (arena_floor)
    DECK = 6.0             # the north bridge's deck: the gate arrives level with it

    # the seat rake: MIRRORS dgBowlDeckY in src/sim/deepglass/layout.ts
    ROWS = 34
    ROW_RUN = 0.95
    ROW_RISE = TOP_Y / ROWS
    LAND_D = 1.85
    LAND_AT = (12, 24)          # a landing is inserted BEFORE these rows
    BENCH_D, BENCH_H = 0.42, 0.18

    def deck_y(r):
        if r <= R_IN:
            return 0.0
        rr, y, EPS = R_IN, 0.0, 1e-9
        for i in range(ROWS):
            if i in LAND_AT:
                if r < rr + LAND_D - EPS:
                    return y
                rr += LAND_D
            if r < rr + ROW_RUN - EPS:
                return y
            rr += ROW_RUN
            y += ROW_RISE
        return TOP_Y

    def rake():
        """(row index | None for a landing, r0, r1, z) walking outward."""
        r, z = R_IN, 0.0
        for i in range(ROWS):
            if i in LAND_AT:
                yield (None, r, r + LAND_D, z)
                r += LAND_D
            yield (i, r, r + ROW_RUN, z)
            r += ROW_RUN
            z += ROW_RISE

    # ---- materials: tiling maps (arena_tex/derive_arena_textures.py) -------
    def load_img(fn, noncolor=False):
        im = bpy.data.images.load(TEXDIR + "/" + fn, check_existing=True)
        if noncolor:
            im.colorspace_settings.name = 'Non-Color'
        return im

    def tex_mat(name, color_fn, normal_fn=None, rough=0.8, metal=0.0, nstr=0.8,
                emit=None, strength=0.0):
        mat = bpy.data.materials.new(name)
        nt, bsdf = _nodes(mat)
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(color_fn)
        t.location = (-500, 250)
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if normal_fn:
            tn = nt.nodes.new('ShaderNodeTexImage')
            tn.image = load_img(normal_fn, True)
            tn.location = (-760, -260)
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.location = (-300, -260)
            nm.inputs['Strength'].default_value = nstr
            nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if emit is not None:
            bsdf.inputs['Emission Color'].default_value = emit
            bsdf.inputs['Emission Strength'].default_value = strength
        return mat

    def flat_mat(name, rgb, rough=0.8, metal=0.0, emit=None, strength=0.0):
        mat = bpy.data.materials.new(name)
        nt, bsdf = _nodes(mat)
        bsdf.inputs['Base Color'].default_value = rgb
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if emit is not None:
            bsdf.inputs['Emission Color'].default_value = emit
            bsdf.inputs['Emission Strength'].default_value = strength
        return mat

    (M_STONE, M_DARK, M_GOLD, M_RUNE, M_CLOTH, M_PAVE, M_SLATE, M_TEAL,
     M_ROOF, M_BACK, M_TIDE, M_PAVE_DK, M_ROOF_SL, M_DRESSED, M_SEAT, M_FLAME) = range(16)
    # A DEEP cyan: the game tone-maps, and the paler Tidehold rune hex clipped
    # to flat white. Light lives in THIN LINES (M_RUNE at full strength) over a
    # dark sea-slate backing (M_BACK), never in whole panels.
    CYAN = srgb(0x1cb6ea)
    MATS = [
        tex_mat("arena_stone", "ArenaAshlar_Color.jpg", "ArenaAshlar_Normal.jpg", rough=0.86, nstr=0.9),
        tex_mat("arena_stone_dark", "ArenaAshlarDark_Color.jpg", "ArenaAshlar_Normal.jpg", rough=0.9, nstr=0.9),
        # Brushed gold: wide-range albedo, a brushed normal, and a faint warm
        # emissive floor so it never goes flat mustard under the dim sky light.
        tex_mat("arena_gold", "ArenaGold_Color.jpg", "ArenaGold_Normal.jpg", rough=0.3, metal=0.8,
                nstr=0.5, emit=(1.0, 0.78, 0.4, 1.0), strength=0.08),
        flat_mat("arena_rune", (0.02, 0.12, 0.17, 1.0), rough=0.3, emit=CYAN, strength=2.6),
        tex_mat("arena_cloth", "ArenaCloth_Color.jpg", None, rough=0.92),
        tex_mat("arena_paving", "ArenaPaving_Color.jpg", "ArenaPaving_Normal.jpg", rough=0.82, nstr=0.7),
        tex_mat("arena_slate", "ArenaSlate_Color.jpg", "ArenaSlate_Normal.jpg", rough=0.66, nstr=0.8),
        tex_mat("arena_teal", "ArenaTeal_Color.jpg", "ArenaTeal_Normal.jpg", rough=0.66, nstr=0.8),
        tex_mat("arena_roof", "ArenaRoof_Color.jpg", "ArenaRoof_Normal.jpg", rough=0.55, nstr=1.6),
        tex_mat("arena_rune_back", "ArenaRuneBack_Color.jpg", None, rough=0.7, metal=0.0,
                emit=(0.02, 0.12, 0.17, 1.0), strength=0.25),
        # the tide channel's water: patched with moving caustics at runtime
        # (src/render/arena_water.ts keys on this material's NAME)
        flat_mat("arena_tide", (0.04, 0.24, 0.34, 1.0), rough=0.06, emit=srgb(0x1cb6ea), strength=0.7),
        tex_mat("arena_paving_dark", "ArenaPavingDark_Color.jpg", "ArenaPaving_Normal.jpg", rough=0.82, nstr=0.7),
        tex_mat("arena_roof_slate", "ArenaRoofSlate_Color.jpg", "ArenaRoof_Normal.jpg", rough=0.62, nstr=1.6),
        tex_mat("arena_dressed", "ArenaDressed_Color.jpg", "ArenaDressed_Normal.jpg", rough=0.8, nstr=0.6),
        tex_mat("arena_seat", "ArenaSeat_Color.jpg", "ArenaDressed_Normal.jpg", rough=0.7, nstr=0.5),
        # fire bowls and lamp globes: bright, but a deep enough base that the
        # tone-mapper keeps them cyan
        flat_mat("arena_flame", (0.01, 0.1, 0.16, 1.0), rough=0.3, emit=srgb(0x19a9e0), strength=1.3),
    ]
    # yards per texture repeat, per material
    K_BY_MAT = {M_STONE: 7.0, M_DARK: 6.0, M_GOLD: 2.5, M_RUNE: 1.0, M_CLOTH: 3.0,
                M_PAVE: 3.2, M_SLATE: 4.0, M_TEAL: 3.2, M_ROOF: 3.0, M_BACK: 5.0,
                M_TIDE: 4.0, M_PAVE_DK: 3.2, M_ROOF_SL: 3.0, M_DRESSED: 4.0, M_SEAT: 4.0,
                M_FLAME: 1.0}

    # ---- little mesh helpers ------------------------------------------------
    def vrow(bm, pts):
        return [bm.verts.new(Vector(p)) for p in pts]

    def bridge(bm, ra, rb, mat=0, smooth=False, flip=False):
        """Quad-strip two equal-length vertex rows."""
        out = []
        for i in range(len(ra) - 1):
            q = [ra[i], ra[i + 1], rb[i + 1], rb[i]]
            if flip:
                q = q[::-1]
            if len(set(q)) < 3:
                continue
            try:
                f = bm.faces.new(q)
            except ValueError:
                continue
            f.material_index = mat
            f.smooth = smooth
            out.append(f)
        return out

    def poly(bm, pts, mat=0, smooth=False):
        vs = vrow(bm, pts)
        try:
            f = bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = mat
        f.smooth = smooth
        return f

    def quad(bm, a, b, c, d, mat=0):
        return poly(bm, [a, b, c, d], mat)

    def vface(bm, vs, mat=0):
        """A face from existing BMVerts (a triangle when two coincide)."""
        vs = [v for i, v in enumerate(vs) if v not in vs[:i]]
        if len(vs) < 3:
            return None
        try:
            f = bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = mat
        return f

    def weld(bm, dist=2e-4):
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=dist)
        bm.normal_update()

    def r4(v):
        return round(float(v), 4)

    # ---- world-yard UVs -------------------------------------------------------
    # Wedge pieces map in the ARENA's polar frame, so the ashlar courses run
    # level round the whole ring and the paving lies in rings: a face that
    # faces the centre takes (arc length, height), a face that runs radially
    # takes (radius, height) and a floor takes (arc length, radius). The arc
    # repeat is snapped per face so a whole number of tiles spans one 22.5
    # degree wedge - the seam between two placed wedges then falls on a tile
    # boundary instead of cutting a course in half. Small pieces (and the bell
    # frame, which is round about its own axis) use a plain box projection.
    def uv_done_layer(bm):
        lay = bm.faces.layers.int.get('uvdone')
        return lay if lay is not None else bm.faces.layers.int.new('uvdone')

    def apply_uvs(bm, rmid=None, cart_below=0.0):
        bm.normal_update()
        uvl = bm.loops.layers.uv.verify()
        done = uv_done_layer(bm)
        for f in bm.faces:
            if f[done]:
                continue
            K = K_BY_MAT.get(f.material_index, 4.0)
            n = f.normal
            c = f.calc_center_median()
            X = c.x + (rmid or 0.0)
            rc = math.hypot(X, c.y)
            if rmid is None or rc < cart_below:
                ax = max(range(3), key=lambda i: abs(n[i]))
                for lp in f.loops:
                    co = lp.vert.co
                    x = co.x + (rmid or 0.0)
                    if ax == 2:
                        lp[uvl].uv = (x / K, co.y / K)
                    elif ax == 0:
                        lp[uvl].uv = (co.y / K, co.z / K)
                    else:
                        lp[uvl].uv = (x / K, co.z / K)
                continue
            thc = math.atan2(c.y, X)
            er = (math.cos(thc), math.sin(thc))
            nr = n.x * er[0] + n.y * er[1]
            nt_ = -n.x * er[1] + n.y * er[0]
            Ku = rc * WSPAN / max(1, round(rc * WSPAN / K))
            horiz = abs(n.z) >= max(abs(nr), abs(nt_))
            radial_face = abs(nr) >= abs(nt_)
            for lp in f.loops:
                co = lp.vert.co
                xv = co.x + rmid
                r = math.hypot(xv, co.y)
                th = math.atan2(co.y, xv)
                if horiz:
                    lp[uvl].uv = (th * rc / Ku, r / K)
                elif radial_face:
                    lp[uvl].uv = (th * rc / Ku, co.z / K)
                else:
                    lp[uvl].uv = (r / K, co.z / K)

    # ---- collision sidecars -------------------------------------------
    # AUTHORED, never voxel-baked: a bake at a 0.6-yd grid seals the arcade and
    # turns the rake into a wall. The sidecar is in the glTF frame: gx = bx,
    # gy = bz, gz = -by; a Blender yaw about +Z becomes the override's `ry`
    # unchanged. Caps (Collision Master): 64 boxes, 24 ramps.
    COLL = {}

    def cbox(cx, cy, cz, hx, hy, hz, ry=0.0):
        b = {"x": r4(cx), "y": r4(cz), "z": r4(-cy),
             "hx": r4(hx), "hy": r4(hz), "hz": r4(hy)}
        if abs(ry) > 1e-6:
            b["ry"] = r4(ry)
        return b

    def sloped_box(r0, r1, t0, t1, top0, top1, z0=0.0, rmid=None):
        """A box running radially from r0 to r1 (centre-line radii) whose top
        rises LINEARLY from top0 to top1: a MapHitbox ridge with pitch 0 and a
        `fall` along its local +X (colliders.ts colliderTopAt). The fall runs
        from moveTopY at the local -X end, so the box is turned to face inward
        (ry = pi) and the high end is its -X end."""
        rm = RMID if rmid is None else rmid
        hi, lo = max(top0, top1), min(top0, top1)
        b = cbox((r0 + r1) / 2 - rm, (t0 + t1) / 2, (z0 + hi) / 2, (r1 - r0) / 2,
                 abs(t1 - t0) / 2, (hi - z0) / 2, ry=math.pi if top1 >= top0 else 0.0)
        b["slope"] = "ridge"
        b["pitch"] = 0
        fall = (hi - lo) / max(1e-6, r1 - r0)
        if fall > 1e-4:
            b["fall"] = r4(fall)
        b["eave"] = r4(z0)
        return b

    def cramp(cx, cy, hx, hy, y0, y1, ry=0.0):
        """A walkable deck: the floor rises along the deck's local +X."""
        d = {"x": r4(cx), "z": r4(-cy), "hx": r4(hx), "hz": r4(hy),
             "y0": r4(y0), "y1": r4(y1)}
        if abs(ry) > 1e-6:
            d["ry"] = r4(ry)
        return d

    def arc_box(r_c, a_c, z_c, h_rad, h_tan, h_z, rmid=None):
        """A box hugging an arc segment: local +X radial, local +Z tangential."""
        rm = RMID if rmid is None else rmid
        return cbox(r_c * math.cos(a_c) - rm, r_c * math.sin(a_c), z_c,
                    h_rad, h_tan, h_z, ry=a_c)

    def angles(a0, a1, n):
        return [a0 + (a1 - a0) * i / n for i in range(n + 1)]

    # A wedge point: world radius r, angle a (0 = wedge centre line), height z,
    # expressed in the wedge's OWN frame (origin at RMID on the centre line).
    def wp(r, a, z):
        return (r * math.cos(a) - RMID, r * math.sin(a), z)

    def arc(r, a0, a1, z, n):
        return [wp(r, a, z) for a in angles(a0, a1, n)]

    def a_of_s(r, s):
        return s / r

    # A straight-line point: radius along the centre line `r`, lateral `t`.
    def lp_(r, t, z):
        return (r - RMID, t, z)

    def tbox(bm, r0, r1, t0, t1, z0, z1, mat, top=None, bottom=False, no_top=False):
        """An axis-aligned box in the wedge frame (r along the centre line)."""
        fs = box(bm, (r1 - r0, t1 - t0, z1 - z0),
                 center=((r0 + r1) / 2 - RMID, (t0 + t1) / 2, (z0 + z1) / 2), mat=mat)
        if top is not None:
            fs[1].material_index = top
        if no_top:
            bm.faces.remove(fs[1])
        if not bottom:
            bm.faces.remove(fs[0])
        return fs

    # ---- walls with round-headed arcades -----------------------------------
    # `place(s, z, t)` maps wall-local (arc-length s, height z, depth t in
    # 0..1 outer->inner) to a 3D point. An opening is (centre_s, half_width,
    # springing_z, base_z, through?).
    def _op(o):
        return (o[0], o[1], o[2], o[3], o[4] if len(o) > 4 else True)

    def _spans(S, openings):
        # SORTED: v1 fed this the gatehouse's openings in declaration order and
        # the running cursor walked backwards, laying a solid span straight
        # across the great arch - the "blocked entrance".
        spans, cur = [], 0.0
        for (cs, hw, _sp, _bz, _th) in sorted((_op(o) for o in openings), key=lambda o: o[0]):
            spans.append((cur, cs - hw))
            cur = cs + hw
        spans.append((cur, S))
        return [(a, b) for (a, b) in spans if b - a > 1e-4]

    def wall_face(bm, place, S, z0, z1, openings, t, mat, flip,
                  nz=5, narch=10, ns=5):
        """One face of a wall, with each opening left as a hole."""
        for (s0, s1) in _spans(S, openings):
            ss = [s0 + (s1 - s0) * i / ns for i in range(ns + 1)]
            prev = None
            for k in range(nz + 1):
                z = z0 + (z1 - z0) * k / nz
                row = vrow(bm, [place(s, z, t) for s in ss])
                if prev:
                    bridge(bm, prev, row, mat, flip=flip)
                prev = row
        for (cs, hw, sp, bz, _th) in (_op(o) for o in openings):
            crown = sp + hw
            ss = [cs - hw + 2 * hw * i / ns for i in range(ns + 1)]
            prev = None
            for k in range(nz + 1):
                z = crown + (z1 - crown) * k / nz
                row = vrow(bm, [place(s, z, t) for s in ss])
                if prev:
                    bridge(bm, prev, row, mat, flip=flip)
                prev = row
            if bz > z0 + 1e-4:
                prev = None
                for k in range(3):
                    z = z0 + (bz - z0) * k / 2
                    row = vrow(bm, [place(s, z, t) for s in ss])
                    if prev:
                        bridge(bm, prev, row, mat, flip=flip)
                    prev = row
            for i in range(narch):
                th0, th1 = math.pi * i / narch, math.pi * (i + 1) / narch
                lim = []
                for th in (th0, th1):
                    c, sn = math.cos(th), math.sin(th)
                    L = hw / sn if sn > 1e-6 else 1e9
                    if abs(c) > 1e-6:
                        L = min(L, hw / abs(c))
                    lim.append(L)
                pts = [place(cs + hw * math.cos(th0), sp + hw * math.sin(th0), t),
                       place(cs + hw * math.cos(th1), sp + hw * math.sin(th1), t),
                       place(cs + lim[1] * math.cos(th1), sp + lim[1] * math.sin(th1), t),
                       place(cs + lim[0] * math.cos(th0), sp + lim[0] * math.sin(th0), t)]
                poly(bm, pts[::-1] if flip else pts, mat)

    def arch_reveal(bm, place, openings, t0, t1, mat, narch=10):
        for (cs, hw, sp, bz, _th) in (_op(o) for o in openings):
            for sgn in (-1, 1):
                s = cs + sgn * hw
                ra = vrow(bm, [place(s, bz, t0), place(s, sp, t0)])
                rb = vrow(bm, [place(s, bz, t1), place(s, sp, t1)])
                bridge(bm, ra, rb, mat, flip=(sgn < 0))
            prev = None
            for i in range(narch + 1):
                th = math.pi * i / narch
                s = cs + hw * math.cos(th)
                z = sp + hw * math.sin(th)
                row = vrow(bm, [place(s, z, t0), place(s, z, t1)])
                if prev:
                    bridge(bm, prev, row, mat, smooth=True, flip=True)
                prev = row

    def arch_fill(bm, place, openings, t, mat, narch=10, flip=False):
        for (cs, hw, sp, bz, _th) in (_op(o) for o in openings):
            ra = vrow(bm, [place(cs - hw, bz, t), place(cs + hw, bz, t)])
            rb = vrow(bm, [place(cs - hw, sp, t), place(cs + hw, sp, t)])
            bridge(bm, ra, rb, mat, flip=flip)
            for i in range(narch):
                th0, th1 = math.pi * i / narch, math.pi * (i + 1) / narch
                pts = [place(cs, sp, t),
                       place(cs + hw * math.cos(th0), sp + hw * math.sin(th0), t),
                       place(cs + hw * math.cos(th1), sp + hw * math.sin(th1), t)]
                poly(bm, pts[::-1] if flip else pts, mat)

    def arcade(bm, place, S, z0, z1, openings, mat_face, mat_soffit,
               through=True, recess=0.16, nz=5, narch=10, ns=5,
               cap_top=False, cap_bottom=False, mat_fill=None):
        ops = [(o[0], o[1], o[2], o[3], o[4] if len(o) > 4 else through)
               for o in openings]
        wall_face(bm, place, S, z0, z1, ops, 0.0, mat_face, False,
                  nz=nz, narch=narch, ns=ns)
        thru = [o for o in ops if o[4]]
        blind = [o for o in ops if not o[4]]
        if thru:
            wall_face(bm, place, S, z0, z1, thru, 1.0, mat_face, True,
                      nz=nz, narch=narch, ns=ns)
            arch_reveal(bm, place, thru, 0.0, 1.0, mat_soffit, narch)
        elif blind:
            wall_face(bm, place, S, z0, z1, [], 1.0, mat_face, True,
                      nz=nz, narch=narch, ns=ns)
        if blind:
            arch_reveal(bm, place, blind, 0.0, recess, mat_soffit, narch)
            arch_fill(bm, place, blind, recess,
                      mat_soffit if mat_fill is None else mat_fill, narch, flip=True)
        if cap_top:
            ss = [S * i / (ns * 4) for i in range(ns * 4 + 1)]
            bridge(bm, vrow(bm, [place(s, z1, 0.0) for s in ss]),
                   vrow(bm, [place(s, z1, 1.0) for s in ss]), mat_face, flip=True)
        if cap_bottom:
            for (s0, s1) in _spans(S, thru):
                bridge(bm, vrow(bm, [place(s0, z0, 0.0), place(s1, z0, 0.0)]),
                       vrow(bm, [place(s0, z0, 1.0), place(s1, z0, 1.0)]), mat_face)

    def gem(bm, center, radius, height, mat=M_RUNE, segs=8, axis='Z'):
        """A cut crystal: an elongated octahedral lathe."""
        prof = [(0.0, 0.0), (radius, height * 0.38), (radius * 0.8, height * 0.62), (0.0, height)]
        fs = lathe(bm, prof, segs=segs, mat=mat, smooth=False, origin=center)
        return fs

    def diamond(bm, r, t, z, facing, s=0.5, mat=M_RUNE):
        """A faceted gem set flat into a wall that faces +X (facing=1) or -X."""
        dv = [lp_(r, t, z - s), lp_(r, t + s * 0.85, z), lp_(r, t, z + s), lp_(r, t - s * 0.85, z)]
        tip = lp_(r + 0.26 * facing, t, z)
        for kk in range(4):
            q = [dv[kk], dv[(kk + 1) % 4], tip]
            poly(bm, q if facing > 0 else q[::-1], mat)

    # =======================================================================
    #  SHARED DRESSING HELPERS
    # =======================================================================
    def cyl_uv(bm, faces, cx, cy, K=None):
        """Wrap `faces` about their OWN vertical axis at (cx, cy): u is arc
        length round it, v is height. For turned parts (towers, cones, drums,
        beacons) the arena's polar frame would smear them."""
        uvl = bm.loops.layers.uv.verify()
        done = uv_done_layer(bm)
        for f in faces:
            if not f.is_valid:
                continue
            k = K or K_BY_MAT.get(f.material_index, 4.0)
            rs, angs = [], []
            for lp in f.loops:
                co = lp.vert.co
                rs.append(math.hypot(co.x - cx, co.y - cy))
                angs.append(math.atan2(co.y - cy, co.x - cx))
            ref = angs[0]
            un = [ref + ((a - ref + math.pi) % TAU) - math.pi for a in angs]
            rf = max(0.05, sum(rs) / len(rs))
            for lp, a in zip(f.loops, un):
                lp[uvl].uv = (a * rf / k, lp.vert.co.z / k)
            f[done] = 1

    def lathe_c(bm, profile, segs=24, mat=0, origin=(0.0, 0.0, 0.0), **kw):
        fs = lathe(bm, profile, segs=segs, mat=mat, origin=origin, **kw)
        cyl_uv(bm, fs, origin[0], origin[1])
        return fs

    def line_strip(bm, place, pts, t, w=0.12, mat=M_RUNE, closed=False):
        """A thin lit line along wall-local (s, z) points at depth t
        (`place(s, z, t)` -> 3D). Segments overlap by half a width so every
        joint closes."""
        P = list(pts) + ([pts[0]] if closed else [])
        for (s0, z0), (s1, z1) in zip(P[:-1], P[1:]):
            ds, dz = s1 - s0, z1 - z0
            L = math.hypot(ds, dz)
            if L < 1e-6:
                continue
            us, uz = ds / L, dz / L
            ns, nz = -uz * w / 2, us * w / 2
            es, ez = us * w / 2, uz * w / 2
            poly(bm, [place(s0 - es + ns, z0 - ez + nz, t), place(s1 + es + ns, z1 + ez + nz, t),
                      place(s1 + es - ns, z1 + ez - nz, t), place(s0 - es - ns, z0 - ez - nz, t)], mat)

    def arch_pts(cs, hw, sp, bz, n=14):
        """An arched opening's outline, foot to foot, in (s, z)."""
        pts = [(cs - hw, bz)]
        for i in range(n + 1):
            th = math.pi - math.pi * i / n
            pts.append((cs + hw * math.cos(th), sp + hw * math.sin(th)))
        pts.append((cs + hw, bz))
        return pts

    def tracery(bm, place, cs, hw, z0, z1, t, arch=False, gold=True, w=0.12, pt=0.0):
        """Rune tracery over a dark panel: an inset border, a spine, a lozenge
        and two bars in cyan light, with gold mullions standing just prouder.
        The panel itself (the dark backing, at depth `pt`) is the caller's;
        the lines stand at depth `t` in front of it, the gold between."""
        ins = min(0.32, hw * 0.22)
        sp = z1 - hw if arch else z1
        if arch:
            border = arch_pts(cs, hw - ins, sp, z0 + ins)
        else:
            border = [(cs - hw + ins, z0 + ins), (cs - hw + ins, z1 - ins),
                      (cs + hw - ins, z1 - ins), (cs + hw - ins, z0 + ins)]
        line_strip(bm, place, border, t, w, closed=True)
        top = (sp + (hw - ins) * 0.92) if arch else (z1 - ins)
        line_strip(bm, place, [(cs, z0 + ins), (cs, top)], t, w)
        zc = z0 + (top - z0) * 0.62
        d = min(hw * 0.55, (top - z0) * 0.16)
        line_strip(bm, place, [(cs, zc - d * 1.4), (cs + d, zc), (cs, zc + d * 1.4), (cs - d, zc)],
                   t, w, closed=True)
        for f in (0.28, 0.46):
            zb = z0 + (top - z0) * f
            line_strip(bm, place, [(cs - hw + ins, zb), (cs + hw - ins, zb)], t, w * 0.8)
        if gold:
            for m in (-1, 1):
                s_ = cs + m * (hw - ins) * 0.5
                line_strip(bm, place, [(s_, z0 + ins), (s_, z0 + (top - z0) * 0.46)],
                           (t + pt) * 0.5, 0.14, mat=M_GOLD)

    def panel(bm, place, cs, hw, z0, z1, t, arch=False, mat=M_BACK):
        """The dark sea-slate backing a tracery sits on."""
        if arch:
            sp = z1 - hw
            ol = arch_pts(cs, hw, sp, z0)
            ctr = place(cs, (z0 + sp) / 2, t)
            vs = [place(s_, z_, t) for (s_, z_) in ol]
            for i in range(len(vs) - 1):
                poly(bm, [vs[i], vs[i + 1], ctr], mat)
            poly(bm, [vs[-1], vs[0], ctr], mat)
        else:
            poly(bm, [place(cs - hw, z0, t), place(cs + hw, z0, t),
                      place(cs + hw, z1, t), place(cs - hw, z1, t)], mat)

    def banner(bm, origin, right, normal, W, H, sway=0.25, sigil=True):
        """A hanging drop of Warden-blue cloth: a gold rod along `right` at
        `origin`, the cloth falling H with a soft belly toward `normal`, a gold
        hem and a traced cyan lozenge on its face."""
        O, R, Nn = Vector(origin), Vector(right).normalized(), Vector(normal).normalized()
        NW, NH = 6, 10
        prev = None
        for j in range(NH + 1):
            v = j / NH
            row = []
            for i in range(NW + 1):
                u = i / NW
                belly = sway * math.sin(u * math.pi) * (v ** 1.2) + 0.08 * math.sin(v * 7.0 + u * 2.0)
                row.append(tuple(O + R * ((u - 0.5) * W) - Vector((0, 0, H * v)) + Nn * (0.05 + belly)))
            vr = vrow(bm, row)
            if prev:
                bridge(bm, prev, vr, M_CLOTH, smooth=True)
            prev = vr
        tube_along(bm, [O + R * (-W / 2 - 0.25) + Nn * 0.05, O + R * (W / 2 + 0.25) + Nn * 0.05],
                   0.07, segs=6, mat=M_GOLD)
        for m in (-1, 1):
            lathe(bm, [(0.0, 0.0), (0.12, 0.05), (0.0, 0.2)], segs=6, mat=M_GOLD,
                  origin=tuple(O + R * (m * (W / 2 + 0.3)) + Nn * 0.05 - Vector((0, 0, 0.1))))
        hem = [O + R * ((i / NW - 0.5) * W) - Vector((0, 0, H)) +
               Nn * (0.07 + sway * math.sin(i / NW * math.pi) + 0.08 * math.sin(7.0 + i / NW * 2.0))
               for i in range(NW + 1)]
        bridge(bm, vrow(bm, [tuple(p) for p in hem]),
               vrow(bm, [tuple(p + Vector((0, 0, 0.28))) for p in hem]), M_GOLD)
        if sigil:
            zc = H * 0.42
            c = O - Vector((0, 0, zc)) + Nn * (0.09 + sway * (0.42 ** 1.2))

            def at(s_, z_, _t):
                return tuple(c + R * s_ + Vector((0, 0, z_)))
            d = min(W * 0.26, H * 0.12)
            line_strip(bm, at, [(0, -d * 1.5), (d, 0), (0, d * 1.5), (-d, 0)], 0, 0.1, closed=True)
            line_strip(bm, at, [(0, -d * 2.6), (0, d * 2.6)], 0, 0.08)

    def beacon(bm, r, t, z0, h=6.0, w=1.2):
        """A tapered obelisk with gold bands and a cyan crystal."""
        o = (r - RMID, t, z0)
        lathe_c(bm, [(w * 0.72, 0.0), (w * 0.72, 0.5), (w * 0.52, 0.62), (w * 0.4, h)], segs=4,
                mat=M_DARK, smooth=False, close_top=True, origin=o)
        for fz in (1.4, h * 0.55, h - 0.35):
            rr = w * 0.72 - (w * 0.72 - w * 0.4) * min(1.0, fz / h) + 0.06
            lathe_c(bm, [(rr, 0.0), (rr, 0.24)], segs=4, mat=M_GOLD, smooth=False,
                    close_top=False, close_bottom=False, origin=(o[0], o[1], z0 + fz))
        for kk in range(4):
            a = math.pi / 4 + kk * math.pi / 2
            tube_along(bm, [Vector((o[0] + math.cos(a) * w * 0.3, t + math.sin(a) * w * 0.3, z0 + h - 0.1)),
                            Vector((o[0] + math.cos(a) * w * 0.62, t + math.sin(a) * w * 0.62, z0 + h + 0.7 * w)),
                            Vector((o[0] + math.cos(a) * w * 0.42, t + math.sin(a) * w * 0.42, z0 + h + 1.5 * w))],
                       0.05 * w, segs=5, mat=M_GOLD)
        gem(bm, (o[0], t, z0 + h + 0.05), w * 0.5, w * 2.0)

    # ---- the rake's walking line --------------------------------------------
    TREAD_MID = (ROW_RUN - BENCH_D) / 2.0     # where feet stand on a row
    RR = ROW_RISE / ROW_RUN
    SLICE = WSPAN / 6.0                       # a slice deck's half-angle (3 per wedge)

    def rake_sections():
        """('rows', r0, r1, z0) and ('land', r0, r1, z) spans of the rake."""
        out = []
        r, z, start, zs = R_IN, 0.0, R_IN, 0.0
        for i in range(ROWS):
            if i in LAND_AT:
                out.append(('rows', start, r, zs))
                out.append(('land', r, r + LAND_D, z))
                r += LAND_D
                start, zs = r, z
            r += ROW_RUN
            z += ROW_RISE
        out.append(('rows', start, r, zs))
        return out
    SECTIONS = rake_sections()

    def rake_mid(r):
        """The line a seated body's feet ride: through the middle of every
        row's tread along a run of rows, level across a landing."""
        for (kind, r0, r1, z0) in SECTIONS:
            if r <= r1 + 1e-9:
                if kind == 'land':
                    return z0
                return z0 + (r - r0 - TREAD_MID) * RR
        k, r0, r1, z0 = SECTIONS[-1]
        return z0 + (r - r0 - TREAD_MID) * RR

    def gang_mid(r):
        """The gangway's walking line: one step per row, a riser above the
        seats beside it, through the middle of each step."""
        for (kind, r0, r1, z0) in SECTIONS:
            if r <= r1 + 1e-9:
                if kind == 'land':
                    return z0
                return z0 + ROW_RISE + (r - r0 - ROW_RUN / 2) * RR
        k, r0, r1, z0 = SECTIONS[-1]
        return z0 + ROW_RISE + (r - r0 - ROW_RUN / 2) * RR

    def rake_decks(thetas=(-2 * SLICE, 0.0, 2 * SLICE), r_lo=None, r_hi=None):
        """Walkable decks for the seating as ROTATED slices about the arena's
        centre: a straight deck along the wedge's centre line reads the rake
        at the wrong radius off that line (a yard low at the seams)."""
        out = []
        for (kind, r0, r1, z0) in SECTIONS:
            a = r0 if r_lo is None else max(r0, r_lo)
            b = r1 if r_hi is None else min(r1, r_hi)
            if b - a < 0.05:
                continue
            y0, y1 = (z0, z0) if kind == 'land' else (rake_mid(a), rake_mid(b))
            for th in thetas:
                rm = (a + b) / 2
                hz = b * math.tan(SLICE) + 0.25
                out.append(cramp(rm * math.cos(th) - RMID, rm * math.sin(th), (b - a) / 2, hz,
                                 y0, y1, ry=th))
        return out

    # =======================================================================
    #  THE RAKE, shared by the stand and the gatehouse's seating blocks
    # =======================================================================
    def rake_rows(bm, cut_angle, sides=(-1, 1), r_max=None, N=8):
        """Tread, bench and riser strips of every row between the cut (an
        angle function of radius) and the wedge edge: dressed limestone rows,
        Tidehold-blue seats."""
        def strip(r0, r1, z0, z1, mat, sgn):
            aa = HA * sgn
            a0 = cut_angle(r0) * sgn
            a1 = cut_angle(r1) * sgn
            lo = [wp(r0, a0 + (aa - a0) * i / N, z0) for i in range(N + 1)]
            hi = [wp(r1, a1 + (aa - a1) * i / N, z1) for i in range(N + 1)]
            return bridge(bm, vrow(bm, lo), vrow(bm, hi), mat, flip=(sgn > 0))

        for (i, r0, r1, z) in rake():
            if r_max is not None and r0 >= r_max - 1e-6:
                break
            r1c = r1 if r_max is None else min(r1, r_max)
            for sgn in sides:
                if i is None:
                    strip(r0, r1c, z, z, M_DRESSED, sgn)
                    continue
                rb = r1 - BENCH_D
                if rb >= r1c:
                    strip(r0, r1c, z, z, M_DRESSED, sgn)
                    continue
                strip(r0, rb, z, z, M_DRESSED, sgn)
                strip(rb, rb, z, z + BENCH_H, M_SEAT, sgn)
                strip(rb, r1c, z + BENCH_H, z + BENCH_H, M_SEAT, sgn)
                if r1c >= r1 - 1e-6:
                    strip(r1, r1, z + BENCH_H, z + ROW_RISE, M_DRESSED, sgn)

    # =======================================================================
    #  THE STAND, one 22.5-degree slice of the bowl
    # =======================================================================
    def build_stand(vom=False):
        bm = bmesh.new()
        N = 8
        WALL_T = 2.4
        GANG_HW = 1.05                # half-width of the centre stair
        VOM_HW = 2.6                  # half-width of the vomitory passage
        AMB_D, AMB_H = 5.2, 9.4
        r_amb = R_OUT - WALL_T - AMB_D     # 91.8: the ambulatory's back wall
        VH = 3.4                           # passage wall height (the vault springs here)
        VAULT_TOP = VH + VOM_HW            # 6.0
        # The passage runs under the rake THROUGH to the ambulatory. The rows
        # stay cut over the vault until they clear it, a slab bridges the slot
        # where they first do, and from VOM_CUT out they run over it unbroken.
        VOM_SLAB = 71.0
        VOM_CUT = 72.9
        SLAB_TOP = VAULT_TOP + 0.3
        VOM_OUT = r_amb
        BAL_T = 0.3                        # the slot's balustrade thickness
        BAL_FLAT = VH + 1.2                # its top where the rows sit low
        PAR_H, PAR_T = 1.45, 0.55          # front parapet: a body cannot step it

        def bal_top(r):
            return max(BAL_FLAT, rake_mid(r) + 1.25)
        R_BAL = next(rr / 20.0 for rr in range(int(R_IN * 20), int(VOM_SLAB * 20))
                     if rake_mid(rr / 20.0) + 1.25 >= BAL_FLAT)

        rake_rows(bm, lambda r: a_of_s(r, VOM_HW if (vom and r < VOM_CUT) else GANG_HW))

        # ---- the centre gangway: gold nosings, a cyan light in each riser ----
        for (i, r0, r1, z) in rake():
            if vom and r0 < VOM_CUT:
                continue
            zt = z if i is None else z + ROW_RISE
            a0, a1 = -a_of_s(r0, GANG_HW), a_of_s(r0, GANG_HW)
            b0, b1 = -a_of_s(r1, GANG_HW), a_of_s(r1, GANG_HW)
            poly(bm, [wp(r0, a0, zt), wp(r0, a1, zt), wp(r1, b1, zt), wp(r1, b0, zt)], M_DRESSED)
            if i is not None:
                poly(bm, [wp(r0, a0, z), wp(r0, a1, z), wp(r0, a1, zt), wp(r0, a0, zt)][::-1], M_DARK)
                # a real lip: a top and a front face, 6 cm proud
                poly(bm, [wp(r0 - 0.04, a0, zt + 0.02), wp(r0 - 0.04, a1, zt + 0.02),
                          wp(r0 + 0.12, a1, zt + 0.02), wp(r0 + 0.12, a0, zt + 0.02)], M_GOLD)
                poly(bm, [wp(r0 - 0.04, a0, zt - 0.06), wp(r0 - 0.04, a1, zt - 0.06),
                          wp(r0 - 0.04, a1, zt + 0.02), wp(r0 - 0.04, a0, zt + 0.02)][::-1], M_GOLD)
                c0, c1 = -a_of_s(r0, 0.22), a_of_s(r0, 0.22)
                poly(bm, [wp(r0 - 0.05, c0, z + ROW_RISE * 0.36), wp(r0 - 0.05, c1, z + ROW_RISE * 0.36),
                          wp(r0 - 0.05, c1, z + ROW_RISE * 0.5), wp(r0 - 0.05, c0, z + ROW_RISE * 0.5)][::-1],
                     M_RUNE)
            for sgn in (-1, 1):
                aa, bb = a_of_s(r0, GANG_HW) * sgn, a_of_s(r1, GANG_HW) * sgn
                q = [wp(r0, aa, z), wp(r1, bb, z), wp(r1, bb, zt), wp(r0, aa, zt)]
                poly(bm, q[::-1] if sgn > 0 else q, M_DARK)

        # ---- the vomitory ----------------------------------------------------
        if vom:
            r0, r1 = R_IN, VOM_OUT
            NV = 12
            NL = 12
            bridge(bm, vrow(bm, [wp(r0, -a_of_s(r0, VOM_HW), FLOOR), wp(r0, a_of_s(r0, VOM_HW), FLOOR)]),
                   vrow(bm, [wp(r1, -a_of_s(r1, VOM_HW), FLOOR), wp(r1, a_of_s(r1, VOM_HW), FLOOR)]),
                   M_SLATE, flip=True)
            for sgn in (-1, 1):
                lo = [wp(r0 + (r1 - r0) * i / NL, a_of_s(r0 + (r1 - r0) * i / NL, VOM_HW) * sgn, 0.0)
                      for i in range(NL + 1)]
                bridge(bm, vrow(bm, lo), vrow(bm, [(p[0], p[1], VH) for p in lo]), M_DARK, flip=(sgn > 0))
                ll = [wp(r0 + (r1 - r0) * i / NL,
                         (a_of_s(r0 + (r1 - r0) * i / NL, VOM_HW) - 0.01 / r0) * sgn, 1.55)
                      for i in range(NL + 1)]
                bridge(bm, vrow(bm, ll), vrow(bm, [(p[0], p[1], 1.66) for p in ll]), M_RUNE, flip=(sgn > 0))
            prev = None
            for i in range(NV + 1):
                th = math.pi * i / NV
                off = VOM_HW * math.cos(th)
                zz = VH + VOM_HW * math.sin(th)
                row = vrow(bm, [wp(r0 + (r1 - r0) * k / NL, a_of_s(r0 + (r1 - r0) * k / NL, off), zz)
                                for k in range(NL + 1)])
                if prev:
                    bridge(bm, prev, row, M_DARK, smooth=True)
                prev = row
            tube_along(bm, [Vector(wp(R_IN - 0.08, a_of_s(R_IN, VOM_HW * math.cos(math.pi * k / 16)),
                                      VH + VOM_HW * math.sin(math.pi * k / 16))) for k in range(17)],
                       0.14, segs=6, mat=M_GOLD)
            # the slot's balustrades: the cut row ends closed, a wall standing
            # 1.25 over the rows (never under the vault's springing), a gold
            # coping on top and a cyan line under it on the slot side
            for sgn in (-1, 1):
                ti, to = VOM_HW * sgn, (VOM_HW + BAL_T) * sgn
                rs = [R_IN] + [rr for (_i, rr, _r1, _z) in rake() if R_IN < rr < VOM_SLAB] + [VOM_SLAB]
                for ra, rb in zip(rs[:-1], rs[1:]):
                    za, zb = bal_top(ra), bal_top(rb)
                    zr = deck_y(ra + 1e-3)
                    q = [lp_(ra, ti, VH), lp_(rb, ti, VH), lp_(rb, ti, zb), lp_(ra, ti, za)]
                    poly(bm, q if sgn < 0 else q[::-1], M_STONE)
                    q = [lp_(ra, to, zr), lp_(rb, to, zr), lp_(rb, to, zb), lp_(ra, to, za)]
                    poly(bm, q[::-1] if sgn < 0 else q, M_STONE)
                    poly(bm, [lp_(ra, ti - 0.05 * sgn, za + 0.02), lp_(rb, ti - 0.05 * sgn, zb + 0.02),
                              lp_(rb, to + 0.05 * sgn, zb + 0.02), lp_(ra, to + 0.05 * sgn, za + 0.02)], M_GOLD)
                    poly(bm, [lp_(ra, ti - 0.012 * sgn, za - 0.3), lp_(rb, ti - 0.012 * sgn, zb - 0.3),
                              lp_(rb, ti - 0.012 * sgn, zb - 0.18), lp_(ra, ti - 0.012 * sgn, za - 0.18)], M_RUNE)
                # the balustrade's outer end over the mouth
                poly(bm, [lp_(R_IN, ti, 0.0), lp_(R_IN, to, 0.0), lp_(R_IN, to, bal_top(R_IN)),
                          lp_(R_IN, ti, bal_top(R_IN))], M_STONE)
            # the slab bridging the slot where the rows first clear the vault,
            # with a gold-capped parapet on its inner edge over the mouth
            sa, sb = a_of_s(VOM_SLAB, VOM_HW + 0.05), a_of_s(VOM_CUT, VOM_HW + 0.05)
            poly(bm, [wp(VOM_SLAB, -sa, SLAB_TOP), wp(VOM_SLAB, sa, SLAB_TOP),
                      wp(VOM_CUT, sb, SLAB_TOP), wp(VOM_CUT, -sb, SLAB_TOP)], M_DRESSED)
            poly(bm, [wp(VOM_SLAB, -sa, VAULT_TOP - 0.5), wp(VOM_SLAB, sa, VAULT_TOP - 0.5),
                      wp(VOM_SLAB, sa, SLAB_TOP), wp(VOM_SLAB, -sa, SLAB_TOP)][::-1], M_STONE)
            PH = 1.0
            pa = sa
            poly(bm, [wp(VOM_SLAB, -pa, SLAB_TOP), wp(VOM_SLAB, pa, SLAB_TOP),
                      wp(VOM_SLAB, pa, SLAB_TOP + PH), wp(VOM_SLAB, -pa, SLAB_TOP + PH)][::-1], M_STONE)
            poly(bm, [wp(VOM_SLAB + 0.4, -pa, SLAB_TOP), wp(VOM_SLAB + 0.4, pa, SLAB_TOP),
                      wp(VOM_SLAB + 0.4, pa, SLAB_TOP + PH), wp(VOM_SLAB + 0.4, -pa, SLAB_TOP + PH)], M_STONE)
            poly(bm, [wp(VOM_SLAB - 0.05, -pa, SLAB_TOP + PH), wp(VOM_SLAB - 0.05, pa, SLAB_TOP + PH),
                      wp(VOM_SLAB + 0.45, pa, SLAB_TOP + PH), wp(VOM_SLAB + 0.45, -pa, SLAB_TOP + PH)], M_GOLD)

        # ---- the front parapet: gold coping, a cyan band, a gap at the stair
        cut0 = a_of_s(R_IN, VOM_HW if vom else GANG_HW)
        for sgn in (-1, 1):
            a0 = cut0 * sgn
            aa = HA * sgn
            lo_i = [wp(R_IN, a0 + (aa - a0) * i / N, 0.0) for i in range(N + 1)]
            lo_o = [wp(R_IN + PAR_T, a0 + (aa - a0) * i / N, 0.0) for i in range(N + 1)]
            hi_i = [(p[0], p[1], PAR_H) for p in lo_i]
            hi_o = [(p[0], p[1], PAR_H) for p in lo_o]
            bridge(bm, vrow(bm, lo_i), vrow(bm, hi_i), M_STONE, flip=(sgn > 0))
            bridge(bm, vrow(bm, hi_i), vrow(bm, hi_o), M_STONE, flip=(sgn > 0))
            poly(bm, [lo_i[0], lo_o[0], hi_o[0], hi_i[0]][::-1 if sgn < 0 else None], M_STONE)
            cap_i = [wp(R_IN - 0.08, a0 + (aa - a0) * i / N, PAR_H) for i in range(N + 1)]
            cap_o = [wp(R_IN + PAR_T + 0.08, a0 + (aa - a0) * i / N, PAR_H) for i in range(N + 1)]
            ci_hi = [(p[0], p[1], PAR_H + 0.14) for p in cap_i]
            co_hi = [(p[0], p[1], PAR_H + 0.14) for p in cap_o]
            bridge(bm, vrow(bm, ci_hi), vrow(bm, co_hi), M_GOLD, flip=(sgn > 0))
            bridge(bm, vrow(bm, cap_i), vrow(bm, ci_hi), M_GOLD, flip=(sgn > 0))
            band = [wp(R_IN - 0.015, a0 + (aa - a0) * i / N, 0.72) for i in range(N + 1)]
            bridge(bm, vrow(bm, band), vrow(bm, [(p[0], p[1], 0.84) for p in band]), M_RUNE, flip=(sgn > 0))

        # ---- the outer facade: three superimposed arcades ------------------
        S = R_OUT * WSPAN
        BAYS = 3
        pitch = S / BAYS
        Z1, Z2, Z3 = 10.4, 21.0, TOP_Y
        CRS = 0.75

        def place_facade(s_, z, t):
            r = R_OUT - WALL_T * t
            return wp(r, (s_ - S / 2) / R_OUT, z)

        g_open = [((j + 0.5) * pitch, 3.4, 5.8, 0.0) for j in range(BAYS)]
        arcade(bm, place_facade, S, 0.0, Z1 - CRS, g_open, M_STONE, M_DARK,
               through=True, nz=4, narch=10, ns=5, cap_bottom=True)
        m_open = [((j + 0.5) * pitch, 3.0, 15.4, 12.2) for j in range(BAYS)]
        NICHE_T = 0.30
        arcade(bm, place_facade, S, Z1, Z2 - CRS, m_open, M_STONE, M_DARK,
               through=False, recess=NICHE_T, nz=4, narch=10, ns=5, mat_fill=M_BACK)
        # rune tracery on the two side niches (the middle bay hangs a banner)
        for (cs, hw, sp, bz) in m_open:
            if abs(cs - S / 2) < 1e-3:
                continue
            tracery(bm, place_facade, cs, hw, bz, sp + hw, NICHE_T - 0.012, arch=True, pt=NICHE_T)
        t_open = [((j + 0.25 + 0.5 * h) * pitch, 1.45, 24.3, 22.6) for j in range(BAYS) for h in (0, 1)]
        arcade(bm, place_facade, S, Z2, Z3, t_open, M_STONE, M_DARK,
               through=False, recess=0.22, nz=3, narch=8, ns=3)

        for (cs, hw, sp, _bz) in g_open:
            pts = []
            for k in range(17):
                th = math.pi * k / 16
                s_ = cs + (hw + 0.22) * math.cos(th)
                pts.append(Vector(wp(R_OUT + 0.1, (s_ - S / 2) / R_OUT, sp + (hw + 0.22) * math.sin(th))))
            tube_along(bm, pts, 0.16, segs=6, mat=M_GOLD)

        for zc in (Z1 - CRS, Z2 - CRS):
            ri, ro = R_OUT - 0.1, R_OUT + 0.85
            b0i = arc(ri, -HA, HA, zc, N)
            b0o = arc(ro, -HA, HA, zc + 0.18, N)
            b1o = arc(ro, -HA, HA, zc + CRS - 0.18, N)
            b1i = arc(ri, -HA, HA, zc + CRS, N)
            bridge(bm, vrow(bm, b0i), vrow(bm, b0o), M_DARK)
            bridge(bm, vrow(bm, b0o), vrow(bm, b1o), M_DARK)
            bridge(bm, vrow(bm, b1o), vrow(bm, b1i), M_GOLD)

        # the banner of the middle bay, hung off the upper string course
        banner(bm, wp(R_OUT + 1.35, 0.0, Z2 - CRS - 0.1), (0, 1, 0), (1, 0, 0), 4.6, 10.6)

        # the ambulatory behind the ground arcade
        if vom:
            S_amb = r_amb * WSPAN

            def place_amb(s_, z, t):
                return wp(r_amb - 0.6 * t, (s_ - S_amb / 2) / r_amb, z)
            arcade(bm, place_amb, S_amb, 0.0, AMB_H, [(S_amb / 2, VOM_HW, VH, 0.0, True)],
                   M_DARK, M_DARK, through=True, nz=4, narch=12, ns=6)
        else:
            bridge(bm, vrow(bm, arc(r_amb, -HA, HA, 0.0, N)),
                   vrow(bm, arc(r_amb, -HA, HA, AMB_H, N)), M_DARK)
        bridge(bm, vrow(bm, arc(r_amb, -HA, HA, AMB_H, N)),
               vrow(bm, arc(R_OUT - WALL_T, -HA, HA, AMB_H, N)), M_DARK, flip=True)
        bridge(bm, vrow(bm, arc(r_amb, -HA, HA, FLOOR, N)),
               vrow(bm, arc(R_OUT - WALL_T, -HA, HA, FLOOR, N)), M_SLATE)
        for j in range(BAYS):
            if vom and j == 1:
                continue
            a = ((j + 0.5) * pitch - S / 2) / R_OUT
            da = a_of_s(r_amb, 0.08)
            poly(bm, [wp(r_amb + 0.02, a - da, 1.6), wp(r_amb + 0.02, a + da, 1.6),
                      wp(r_amb + 0.02, a + da, 6.4), wp(r_amb + 0.02, a - da, 6.4)], M_RUNE)

        # ---- pilasters with gold capitals, cornice and crown ----------------
        for j in range(BAYS + 1):
            s_ = j * pitch
            a = (s_ - S / 2) / R_OUT
            seam = j in (0, BAYS)
            hw = a_of_s(R_OUT, 1.55)
            a0 = a if (seam and j == 0) else a - hw
            a1 = a if (seam and j == BAYS) else a + hw
            for (zz, proj, h, m) in ((0.0, 0.55, 1.4, M_DARK), (1.4, 1.15, Z2 - 1.4 - 0.5, M_STONE),
                                     (Z2 - 0.5, 1.2, 0.5, M_GOLD),
                                     (Z2, 0.80, Z3 - Z2, M_STONE), (Z3, 1.45, 1.1, M_STONE)):
                ro, ri = R_OUT + proj, R_OUT - 0.25
                lo0 = [wp(ri, a0, zz), wp(ro, a0, zz), wp(ro, a1, zz), wp(ri, a1, zz)]
                hi0 = [(p[0], p[1], zz + h) for p in lo0]
                for i in range(4):
                    poly(bm, [lo0[i], lo0[(i + 1) % 4], hi0[(i + 1) % 4], hi0[i]], m)
                poly(bm, hi0[::-1], m)

        for (z0c, h, ro_off, m) in ((TOP_Y, 1.1, 1.5, M_STONE), (TOP_Y + 1.1, 0.22, 1.5, M_GOLD),
                                    (TOP_Y + 1.32, 1.68, 0.6, M_STONE)):
            ri, ro = R_OUT - WALL_T, R_OUT + ro_off
            lo_i, lo_o = arc(ri, -HA, HA, z0c, N), arc(ro, -HA, HA, z0c, N)
            hi_i, hi_o = arc(ri, -HA, HA, z0c + h, N), arc(ro, -HA, HA, z0c + h, N)
            bridge(bm, vrow(bm, lo_o), vrow(bm, hi_o), m)
            bridge(bm, vrow(bm, hi_i), vrow(bm, hi_o), m, flip=True)
            bridge(bm, vrow(bm, lo_i), vrow(bm, hi_i), m, flip=True)
            bridge(bm, vrow(bm, lo_i), vrow(bm, lo_o), m)

        for j in range(BAYS):
            a = ((j + 0.5) * pitch - S / 2) / R_OUT
            o = wp(R_OUT + 0.55, a, TOP_Y + 3.0)
            lathe(bm, [(0.0, 0.0), (0.3, 0.05), (0.36, 0.22), (0.27, 0.38), (0.0, 0.44)],
                  segs=14, mat=M_FLAME, origin=o)
            torus(bm, 0.4, 0.07, major=16, minor=5, mat=M_GOLD, center=(o[0], o[1], TOP_Y + 3.02))

        PL_D, PL_T = 2.2, 1.35
        for (z0p, z1p, o0, o1) in ((-PL_D, 0.0, 1.55, 1.55), (0.0, PL_T, 1.55, 0.30)):
            bridge(bm, vrow(bm, arc(R_OUT + o0, -HA, HA, z0p, N)),
                   vrow(bm, arc(R_OUT + o1, -HA, HA, z1p, N)), M_DARK)
        bridge(bm, vrow(bm, arc(R_OUT - WALL_T, -HA, HA, -PL_D, N)),
               vrow(bm, arc(R_OUT + 1.55, -HA, HA, -PL_D, N)), M_DARK, flip=True)
        bridge(bm, vrow(bm, arc(R_OUT + 0.30, -HA, HA, PL_T, N)),
               vrow(bm, arc(R_OUT - WALL_T, -HA, HA, PL_T, N)), M_DARK, flip=True)

        # ---- authored collision --------------------------------------------
        tag = "arena_stand_vom" if vom else "arena_stand"
        boxes, ramps = [], []
        if vom:
            # the side slices whole; the centre slice only where the rows run
            # over the passage; beside the slot, straight strips at the rake
            # height of their own middle
            ramps += rake_decks(thetas=(-2 * SLICE, 2 * SLICE))
            ramps += rake_decks(thetas=(0.0,), r_lo=VOM_CUT)
            for (kind, r0, r1, z0) in SECTIONS:
                a, b = r0, min(r1, VOM_CUT)
                if b - a < 0.05:
                    continue
                t_in = VOM_HW + BAL_T
                t_out = b * math.tan(SLICE) + 0.25
                tm = (t_in + t_out) / 2
                for sgn in (-1, 1):
                    ramps.append(cramp((a + b) / 2 - RMID, sgn * tm, (b - a) / 2, (t_out - t_in) / 2,
                                       rake_mid(math.hypot(a, tm)), rake_mid(math.hypot(b, tm))))
        else:
            ramps += rake_decks()
        # the gangway, a riser above the seats beside it
        g_lo = VOM_CUT if vom else R_IN
        for (kind, r0, r1, z0) in SECTIONS:
            if kind != 'rows':
                continue
            a = max(r0, g_lo)
            if r1 - a < 0.05:
                continue
            ramps.append(cramp((a + r1) / 2 - RMID, 0.0, (r1 - a) / 2, GANG_HW, gang_mid(a), gang_mid(r1)))
        ramps.append(cramp((r_amb + R_OUT - WALL_T) / 2 - RMID, 0.0, (R_OUT - WALL_T - r_amb) / 2,
                           (R_OUT - WALL_T) * math.sin(HA), FLOOR, FLOOR))
        for j in range(BAYS):
            a = ((j + 0.5) * pitch - S / 2) / R_OUT
            htan = (pitch / 2) * 1.02
            crown = 5.8 + 3.4
            boxes.append(arc_box(R_OUT - WALL_T / 2, a, (crown + Z3 + 3.0) / 2,
                                 WALL_T / 2, htan, (Z3 + 3.0 - crown) / 2))
            if vom and j == 1:
                side = (htan - VOM_HW) / 2
                for sgn in (-1, 1):
                    boxes.append(arc_box(r_amb - 0.3, a + sgn * a_of_s(r_amb, VOM_HW + side), AMB_H / 2,
                                         0.3, side, AMB_H / 2))
                boxes.append(arc_box(r_amb - 0.3, a, (VAULT_TOP + AMB_H) / 2, 0.3, VOM_HW,
                                     (AMB_H - VAULT_TOP) / 2))
            else:
                boxes.append(arc_box(r_amb - 0.3, a, AMB_H / 2, 0.3, htan, AMB_H / 2))
        for j in range(BAYS + 1):
            a = (j * pitch - S / 2) / R_OUT
            seam = j in (0, BAYS)
            htan = a_of_s(R_OUT, 1.55) * R_OUT * (0.5 if seam else 1.0)
            off = (a_of_s(R_OUT, 1.55) / 2) * (1 if j == 0 else -1) if seam else 0.0
            boxes.append(arc_box(R_OUT - WALL_T / 2 + 0.3, a + off, 4.6, WALL_T / 2 + 0.6, htan, 4.6))
        # the front parapet, in three arcs, open at the stair / the passage
        PZ = (PAR_H + 0.14) / 2
        for j in range(3):
            lo_a, hi_a = -HA + WSPAN * j / 3, -HA + WSPAN * (j + 1) / 3
            parts = [(lo_a, hi_a)]
            if j == 1:
                parts = [(lo_a, -cut0), (cut0, hi_a)]
            for (p0, p1) in parts:
                boxes.append(arc_box(R_IN + PAR_T / 2, (p0 + p1) / 2, PZ, PAR_T / 2 + 0.08,
                                     (p1 - p0) / 2 * R_IN * 1.02, PZ))
        if vom:
            ramps.append(cramp((R_IN + VOM_OUT) / 2 - RMID, 0.0, (VOM_OUT - R_IN) / 2, VOM_HW, FLOOR, FLOOR))
            for sgn in (-1, 1):
                t0, t1 = VOM_HW * sgn, (VOM_HW + BAL_T) * sgn
                # the slot's balustrade: level where the rows sit low, then
                # rising with them to the slab; the passage's wall below it
                boxes.append(cbox((R_IN + R_BAL) / 2 - RMID, (t0 + t1) / 2, BAL_FLAT / 2,
                                  (R_BAL - R_IN) / 2, BAL_T / 2, BAL_FLAT / 2))
                boxes.append(sloped_box(R_BAL, VOM_SLAB, t0, t1, bal_top(R_BAL), bal_top(VOM_SLAB)))
                # the passage's cheeks where it runs on under the rows
                boxes.append(cbox((VOM_SLAB + VOM_OUT) / 2 - RMID, sgn * (VOM_HW + 0.35), VAULT_TOP / 2,
                                  (VOM_OUT - VOM_SLAB) / 2, 0.35, VAULT_TOP / 2))
            ramps.append(cramp((VOM_SLAB + VOM_CUT) / 2 - RMID, 0.0, (VOM_CUT - VOM_SLAB) / 2,
                               VOM_HW + 0.05, SLAB_TOP, SLAB_TOP))
            boxes.append(cbox(VOM_SLAB + 0.2 - RMID, 0.0, (VAULT_TOP + SLAB_TOP + PH) / 2, 0.2,
                              VOM_HW + 0.05, (SLAB_TOP + PH - VAULT_TOP) / 2))
        COLL[tag] = dict(boxes=boxes, ramps=ramps)
        LOG.append(f"{tag}: vom balustrade rises from r {R_BAL:.2f}" if vom else f"{tag}: slice decks")

        weld(bm)
        apply_uvs(bm, RMID)
        return new_obj(tag, bm, MATS)

    # =======================================================================
    #  GATEHOUSE, the Tide Gate, where the north bridge lands
    # =======================================================================
    # Radii measured ALONG the centre line (the gate is laid out straight):
    #   104.8 .. 99.4  arrival terrace at the bridge deck (y 6), flanked by two
    #                  towers standing out over the water, beacons at its lip
    #    99.4 .. 97.0  the facade: open great arch, medallion, attic crest
    #    97.0 .. 86.0  vaulted hall at y 6 (gold ribs, lit coffers, tracery)
    #    86.0 .. 64.9  the grand stair: 18 risers in two flights round a
    #                  landing, down to the floor (y 0.40), in a canyon between
    #                  two seating blocks that carry the bowl's rows to its walls
    #    65.4 .. 63.9  forecourt, flanked by beacon pedestals
    def build_gatehouse():
        bm = bmesh.new()
        N = 8
        WALL_T = 2.4
        S = R_OUT * WSPAN
        PW = 7.0                   # passage half-width (the bridge is 12 between rails)
        CW = PW + 0.5              # canyon wall outer face: where the rows begin
        BW = 11.0                  # the gate block's half-width
        R_PORTAL = 86.0
        R_FAC = R_OUT - WALL_T     # 97.0
        TOP = TOP_Y + 11.0         # 38: the facade's attic
        BLOCK_TOP = TOP_Y + 4.0    # 31: the gate block's roof
        SPRING = DECK + 7.5        # 13.5
        CROWN = SPRING + PW        # 20.5
        R_TER = 104.8
        N_RISE = 18
        LAND_K = 9                 # the landing is the tread after riser 8
        LAND_X = 2.3               # its extra depth over a tread
        R_ST0 = 65.4
        RISE = (DECK - FLOOR) / N_RISE
        RUN = (R_PORTAL - R_ST0 - LAND_X) / N_RISE
        R_FORE = 63.9              # the forecourt starts where the floor wedge ends
        PAR_H, PAR_T = 1.45, 0.55

        def riser_r(k):
            return R_ST0 + k * RUN + (LAND_X if k >= LAND_K else 0.0)

        def stair_mid(r):
            """The stair's walking line: through the middle of every tread."""
            if r <= riser_r(LAND_K - 1) + RUN / 2:
                return max(FLOOR, FLOOR + RISE + (r - R_ST0 - RUN / 2) * RISE / RUN)
            if r <= riser_r(LAND_K) - RUN / 2:
                return FLOOR + LAND_K * RISE
            return min(DECK, FLOOR + (LAND_K + 1) * RISE + (r - riser_r(LAND_K) - RUN / 2) * RISE / RUN)

        def coping(r):
            return rake_mid(r) + 1.25

        def t_in(r):
            return BW if r >= R_PORTAL - 1e-6 else CW

        # ---- the seating blocks either side of the canyon ------------------
        rake_rows(bm, lambda r: math.asin(min(0.999, t_in(r) / r)), r_max=R_FAC)
        for (i, r0, r1, z) in rake():
            if r0 >= R_FAC:
                break
            r1c = min(r1, R_FAC)
            for sgn in (-1, 1):
                q = [wp(r0, HA * sgn, 0.0), wp(r1c, HA * sgn, 0.0), wp(r1c, HA * sgn, z), wp(r0, HA * sgn, z)]
                if z > 0.01:
                    poly(bm, q[::-1] if sgn > 0 else q, M_DARK)
        # their front parapet, beside the pedestals
        PED_R0, PED_R1, PED_H = R_IN - 0.4, R_IN + 2.6, 2.4
        a_ped = a_of_s(R_IN, PW + 2.8)
        for sgn in (-1, 1):
            a0, aa = a_ped * sgn, HA * sgn
            lo_i = [wp(R_IN, a0 + (aa - a0) * i / N, 0.0) for i in range(N + 1)]
            lo_o = [wp(R_IN + PAR_T, a0 + (aa - a0) * i / N, 0.0) for i in range(N + 1)]
            hi_i = [(p[0], p[1], PAR_H) for p in lo_i]
            hi_o = [(p[0], p[1], PAR_H) for p in lo_o]
            bridge(bm, vrow(bm, lo_i), vrow(bm, hi_i), M_STONE, flip=(sgn > 0))
            bridge(bm, vrow(bm, hi_i), vrow(bm, hi_o), M_STONE, flip=(sgn > 0))
            cap_i = [wp(R_IN - 0.08, a0 + (aa - a0) * i / N, PAR_H + 0.14) for i in range(N + 1)]
            cap_o = [wp(R_IN + PAR_T + 0.08, a0 + (aa - a0) * i / N, PAR_H + 0.14) for i in range(N + 1)]
            bridge(bm, vrow(bm, cap_i), vrow(bm, cap_o), M_GOLD, flip=(sgn > 0))
            band = [wp(R_IN - 0.015, a0 + (aa - a0) * i / N, 0.72) for i in range(N + 1)]
            bridge(bm, vrow(bm, band), vrow(bm, [(p[0], p[1], 0.84) for p in band]), M_RUNE, flip=(sgn > 0))

        # ---- canyon walls: ONE continuous coping line, gold cap, cyan line ---
        cw_rs = [PED_R1, 74.8, 76.65, R_PORTAL]
        fine = []
        for ra, rb in zip(cw_rs[:-1], cw_rs[1:]):
            n = max(1, int((rb - ra) / 1.5))
            fine += [ra + (rb - ra) * i / n for i in range(n)]
        fine.append(R_PORTAL)
        for sgn in (-1, 1):
            ti, to = PW * sgn, CW * sgn
            for ra, rb in zip(fine[:-1], fine[1:]):
                ca, cb = coping(ra), coping(rb)
                q = [lp_(ra, ti, 0.0), lp_(rb, ti, 0.0), lp_(rb, ti, cb), lp_(ra, ti, ca)]
                poly(bm, q if sgn > 0 else q[::-1], M_STONE)
                poly(bm, [lp_(ra, ti - 0.06 * sgn, ca), lp_(rb, ti - 0.06 * sgn, cb),
                          lp_(rb, to + 0.06 * sgn, cb), lp_(ra, to + 0.06 * sgn, ca)], M_GOLD)
                poly(bm, [lp_(ra, ti - 0.06 * sgn, ca - 0.14), lp_(rb, ti - 0.06 * sgn, cb - 0.14),
                          lp_(rb, ti - 0.06 * sgn, cb), lp_(ra, ti - 0.06 * sgn, ca)], M_GOLD)
                poly(bm, [lp_(ra, ti - 0.012 * sgn, ca - 0.42), lp_(rb, ti - 0.012 * sgn, cb - 0.42),
                          lp_(rb, ti - 0.012 * sgn, cb - 0.3), lp_(ra, ti - 0.012 * sgn, ca - 0.3)], M_RUNE)
            # the row side: from each row's tread up to the coping
            for (i, r0, r1, z) in rake():
                if r1 <= PED_R1 or r0 >= R_PORTAL:
                    continue
                a, b = max(r0, PED_R1), min(r1, R_PORTAL)
                q = [lp_(a, to, z), lp_(b, to, z), lp_(b, to, coping(b)), lp_(a, to, coping(a))]
                poly(bm, q[::-1] if sgn > 0 else q, M_STONE)
            # handrail + light line following the stair
            pts_rail, band_lo, band_hi = [], [], []
            samples = [R_ST0 - RUN / 2 + (R_PORTAL - R_ST0 + RUN / 2) * i / 40 for i in range(41)]
            for r in samples:
                yn = stair_mid(r)
                pts_rail.append(Vector(lp_(r, (PW - 0.16) * sgn, yn + 0.95)))
                band_lo.append(lp_(r, (PW - 0.02) * sgn, yn + 1.34))
                band_hi.append(lp_(r, (PW - 0.02) * sgn, yn + 1.44))
            tube_along(bm, pts_rail, 0.06, segs=6, mat=M_GOLD)
            for k in range(0, 41, 5):
                p = pts_rail[k]
                tube_along(bm, [p, Vector((p.x, (PW - 0.02) * sgn, p.z))], 0.035, segs=5, mat=M_GOLD)
            bridge(bm, vrow(bm, band_lo), vrow(bm, band_hi), M_RUNE, flip=(sgn < 0))

            # traced blind arches between gold pilasters, and banners between them
            def place_cw(s_, z, tt, sg=sgn):
                return lp_(s_, sg * (PW - 0.03 - 0.02 * tt), z)
            for rc in (71.0, 77.8, 83.0):
                hw = 1.35
                zb = stair_mid(rc) + 1.8
                zt = coping(rc) - 1.0
                if zt - zb < hw + 0.8:
                    continue
                panel(bm, place_cw, rc, hw, zb, zt, 0.0, arch=True)
                tracery(bm, place_cw, rc, hw, zb, zt, 2.0, arch=True)
                arcv = [Vector(place_cw(rc + (hw + 0.2) * math.cos(math.pi * k / 16),
                                        zt - hw + (hw + 0.2) * math.sin(math.pi * k / 16), -1.5))
                        for k in range(17)]
                tube_along(bm, arcv, 0.1, segs=6, mat=M_GOLD)
                for m in (-1, 1):
                    tube_along(bm, [Vector(place_cw(rc + m * (hw + 0.2), zb, -1.5)),
                                    Vector(place_cw(rc + m * (hw + 0.2), zt - hw, -1.5))], 0.1, segs=6, mat=M_GOLD)
            for rb_ in (74.3, 80.4):
                ztop = coping(rb_) - 0.6
                drop = min(6.5, ztop - stair_mid(rb_) - 2.6)
                if drop > 2.0:
                    banner(bm, lp_(rb_, sgn * (PW - 0.12), ztop), (1, 0, 0), (0, -sgn, 0), 2.4, drop, sway=0.15)

        # ---- the grand stair: two flights round a landing ---------------------
        def tread(ra, rb, y):
            cols = [(-PW, -0.27, M_PAVE), (-0.27, -0.15, M_GOLD), (-0.15, 0.15, M_RUNE),
                    (0.15, 0.27, M_GOLD), (0.27, PW, M_PAVE)]
            for (t0, t1, m) in cols:
                quad(bm, lp_(ra, t0, y), lp_(ra, t1, y), lp_(rb, t1, y), lp_(rb, t0, y), m)
        for k in range(N_RISE):
            rk = riser_r(k)
            y_lo = FLOOR + k * RISE
            y_hi = y_lo + RISE
            quad(bm, lp_(rk, -PW, y_lo), lp_(rk, PW, y_lo), lp_(rk, PW, y_hi), lp_(rk, -PW, y_hi), M_DARK)
            quad(bm, lp_(rk - 0.01, -PW + 0.4, y_hi - 0.16), lp_(rk - 0.01, PW - 0.4, y_hi - 0.16),
                 lp_(rk - 0.01, PW - 0.4, y_hi - 0.1), lp_(rk - 0.01, -PW + 0.4, y_hi - 0.1), M_RUNE)
            if k < N_RISE - 1:
                tread(rk, riser_r(k + 1), y_hi)
            tbox(bm, rk - 0.05, rk + 0.12, -PW, PW, y_hi - 0.07, y_hi + 0.01, M_GOLD)

        # ---- forecourt + beacon pedestals at the canyon mouth ---------------
        tread(R_FORE, R_ST0, FLOOR)
        for sgn in (-1, 1):
            t0, t1 = (PW, PW + 2.8) if sgn > 0 else (-PW - 2.8, -PW)
            tbox(bm, PED_R0, PED_R1, t0, t1, 0.0, PED_H, M_STONE, top=M_DARK)
            tbox(bm, PED_R0 - 0.1, PED_R1 + 0.1, t0 - 0.1, t1 + 0.1, PED_H, PED_H + 0.22, M_GOLD)
            beacon(bm, (PED_R0 + PED_R1) / 2, (t0 + t1) / 2, PED_H + 0.22, h=7.5, w=1.5)

        # ---- the gate block: hall, portal and upper storey ------------------
        def place_pf(s_, z, tt):
            return lp_(R_PORTAL + 1.2 * tt, s_ - BW, z)
        arcade(bm, place_pf, 2 * BW, DECK, BLOCK_TOP, [(BW, PW, SPRING, DECK, True)],
               M_STONE, M_DARK, through=True, nz=6, narch=16, ns=6)
        quad(bm, lp_(R_PORTAL, -BW, 0.0), lp_(R_PORTAL, BW, 0.0),
             lp_(R_PORTAL, BW, DECK), lp_(R_PORTAL, -BW, DECK), M_STONE)
        arcv = [Vector(lp_(R_PORTAL - 0.1, (PW + 0.4) * math.cos(math.pi * k / 24),
                           SPRING + (PW + 0.4) * math.sin(math.pi * k / 24))) for k in range(25)]
        tube_along(bm, arcv, 0.34, segs=8, mat=M_GOLD)
        for sgn in (-1, 1):
            tbox(bm, R_PORTAL - 0.35, R_PORTAL + 0.05, (PW + 0.1) * sgn - 0.3, (PW + 0.1) * sgn + 0.3,
                 DECK, SPRING, M_GOLD)
        tbox(bm, R_PORTAL - 0.45, R_PORTAL + 0.1, -0.85, 0.85, CROWN - 0.3, CROWN + 1.9, M_STONE)
        diamond(bm, R_PORTAL - 0.46, 0.0, CROWN + 0.8, -1)
        # the rose window: dark glass, traced in cyan, gold ring and spokes
        ROSE_Z, ROSE_R = CROWN + 5.2, 3.0

        def place_rose(s_, z, tt):
            return lp_(R_PORTAL - 0.06 - 0.02 * tt, s_, z)
        disc = [place_rose(math.cos(TAU * k / 32) * ROSE_R, ROSE_Z + math.sin(TAU * k / 32) * ROSE_R, 0)
                for k in range(32)]
        ctr = place_rose(0.0, ROSE_Z, 0)
        for k in range(32):
            poly(bm, [disc[k], disc[(k + 1) % 32], ctr], M_BACK)
        for rr in (ROSE_R * 0.78, ROSE_R * 0.42):
            line_strip(bm, place_rose, [(math.cos(TAU * k / 24) * rr, ROSE_Z + math.sin(TAU * k / 24) * rr)
                                        for k in range(24)], 2.0, 0.1, closed=True)
        for k in range(8):
            a = TAU * (k + 0.5) / 8
            line_strip(bm, place_rose, [(math.cos(a) * ROSE_R * 0.42, ROSE_Z + math.sin(a) * ROSE_R * 0.42),
                                        (math.cos(a) * ROSE_R * 0.78, ROSE_Z + math.sin(a) * ROSE_R * 0.78)],
                       2.0, 0.08)
        torus(bm, ROSE_R + 0.1, 0.3, major=40, minor=8, mat=M_GOLD, center=lp_(R_PORTAL - 0.12, 0.0, ROSE_Z), axis='X')
        for kk in range(8):
            a = TAU * kk / 8
            tube_along(bm, [Vector(lp_(R_PORTAL - 0.16, 0.0, ROSE_Z)),
                            Vector(lp_(R_PORTAL - 0.16, math.cos(a) * ROSE_R, ROSE_Z + math.sin(a) * ROSE_R))],
                       0.1, segs=5, mat=M_GOLD)
        torus(bm, 0.7, 0.16, major=16, minor=6, mat=M_GOLD, center=lp_(R_PORTAL - 0.18, 0.0, ROSE_Z), axis='X')
        # rune lines up the piers, a cornice with a gold fillet, the roof
        for sgn in (-1, 1):
            tc = (PW + BW) / 2 * sgn
            line_strip(bm, place_rose, [(tc, DECK + 1.0), (tc, CROWN + 3.0)], 2.0, 0.14)
            line_strip(bm, place_rose, [(tc - 0.5, CROWN + 3.3), (tc, CROWN + 3.9), (tc + 0.5, CROWN + 3.3),
                                        (tc, CROWN + 2.7)], 2.0, 0.1, closed=True)
        tbox(bm, R_PORTAL - 0.9, R_FAC, -BW - 0.9, BW + 0.9, BLOCK_TOP - 1.3, BLOCK_TOP - 0.3,
             M_STONE, no_top=True, bottom=True)
        tbox(bm, R_PORTAL - 0.95, R_FAC, -BW - 0.95, BW + 0.95, BLOCK_TOP - 0.3, BLOCK_TOP, M_GOLD, no_top=True)
        for sgn in (-1, 1):
            q = [lp_(R_PORTAL, BW * sgn, 0.0), lp_(R_FAC, BW * sgn, 0.0),
                 lp_(R_FAC, BW * sgn, BLOCK_TOP), lp_(R_PORTAL, BW * sgn, BLOCK_TOP)]
            poly(bm, q[::-1] if sgn > 0 else q, M_STONE)
        quad(bm, lp_(R_PORTAL, -BW, BLOCK_TOP), lp_(R_FAC, -BW, BLOCK_TOP),
             lp_(R_FAC, BW, BLOCK_TOP), lp_(R_PORTAL, BW, BLOCK_TOP), M_PAVE_DK)
        for sgn in (-1, 1):
            tbox(bm, R_PORTAL - 0.9, R_FAC, sgn * (BW + 0.45) - 0.45, sgn * (BW + 0.45) + 0.45,
                 BLOCK_TOP, BLOCK_TOP + 1.0, M_STONE, top=M_GOLD)
        tbox(bm, R_PORTAL - 0.9, R_PORTAL, -BW, BW, BLOCK_TOP, BLOCK_TOP + 1.0, M_STONE, top=M_GOLD)

        # the hall: walls, barrel vault, gold ribs on capitals, lit coffers,
        # traced panels, a narrow lit runner with gold borders
        R_TOPSTEP = riser_r(N_RISE - 1)
        for sgn in (-1, 1):
            q = [lp_(R_PORTAL, PW * sgn, DECK), lp_(R_FAC, PW * sgn, DECK),
                 lp_(R_FAC, PW * sgn, SPRING), lp_(R_PORTAL, PW * sgn, SPRING)]
            poly(bm, q if sgn > 0 else q[::-1], M_STONE)
        prev = None
        for kk in range(25):
            th = math.pi * kk / 24
            row = vrow(bm, [lp_(R_PORTAL + 1.2, PW * math.cos(th), SPRING + PW * math.sin(th)),
                            lp_(R_FAC, PW * math.cos(th), SPRING + PW * math.sin(th))])
            if prev:
                bridge(bm, prev, row, M_STONE, smooth=True, flip=True)
            prev = row
        RIBS = (88.4, 91.5, 94.6)
        for rr in RIBS:
            rib = [Vector(lp_(rr, (PW - 0.18) * math.cos(math.pi * k / 24),
                              SPRING + (PW - 0.18) * math.sin(math.pi * k / 24))) for k in range(25)]
            tube_along(bm, rib, 0.35, segs=8, mat=M_GOLD)
            for sgn in (-1, 1):
                tbox(bm, rr - 0.3, rr + 0.3, (PW - 0.22) * sgn - 0.12, (PW - 0.22) * sgn + 0.12,
                     DECK, SPRING - 0.4, M_GOLD)
                tbox(bm, rr - 0.55, rr + 0.55, (PW - 0.42) * sgn - 0.42, (PW - 0.42) * sgn + 0.42,
                     SPRING - 0.4, SPRING + 0.1, M_GOLD)

        # the coffers: a dark band along the crown, ruled in cyan between ribs
        def place_vault(s_, z, tt):
            """s = r along the hall, z = angle round the vault (radians)."""
            rad = PW - 0.04 - 0.02 * tt
            return lp_(s_, rad * math.cos(z), SPRING + rad * math.sin(z))
        th0, th1 = math.radians(58), math.radians(122)
        bays = [R_PORTAL + 1.4] + list(RIBS) + [R_FAC - 0.2]
        for ra, rb in zip(bays[:-1], bays[1:]):
            a0, b0 = ra + 0.45, rb - 0.45
            for k in range(6):
                z0_, z1_ = th0 + (th1 - th0) * k / 6, th0 + (th1 - th0) * (k + 1) / 6
                poly(bm, [place_vault(a0, z0_, 0), place_vault(b0, z0_, 0),
                          place_vault(b0, z1_, 0), place_vault(a0, z1_, 0)], M_BACK)
            line_strip(bm, place_vault, [(a0, th0), (b0, th0), (b0, th1), (a0, th1)], 2.0, 0.1,
                       closed=True)
            line_strip(bm, place_vault, [(a0, math.pi / 2), (b0, math.pi / 2)], 2.0, 0.08)
        for rr in (90.0, 93.05, 96.0):
            for sgn in (-1, 1):
                def place_hw(s_, z, tt, sg=sgn):
                    return lp_(s_, sg * (PW - 0.02 - 0.02 * tt), z)
                panel(bm, place_hw, rr, 0.75, DECK + 1.5, DECK + 5.6, 0.0)
                tracery(bm, place_hw, rr, 0.75, DECK + 1.5, DECK + 5.6, 2.0, gold=False, w=0.09)
        for (t0, t1, m) in ((-PW, -0.27, M_SLATE), (-0.27, -0.15, M_GOLD), (-0.15, 0.15, M_RUNE),
                            (0.15, 0.27, M_GOLD), (0.27, PW, M_SLATE)):
            quad(bm, lp_(R_TOPSTEP, t0, DECK), lp_(R_TOPSTEP, t1, DECK), lp_(R_OUT, t1, DECK),
                 lp_(R_OUT, t0, DECK), m)

        # ---- the outer facade --------------------------------------------------
        def place_g(s_, z, t):
            r = R_OUT - WALL_T * t
            return wp(r, (s_ - S / 2) / R_OUT, z)
        NICHE_S = 16.6
        opens = [(S / 2, PW, SPRING, DECK, True),
                 (S / 2 - NICHE_S, 1.5, 14.8, 8.6, False),
                 (S / 2 + NICHE_S, 1.5, 14.8, 8.6, False)]
        arcade(bm, place_g, S, 0.0, TOP, opens, M_STONE, M_DARK,
               through=True, nz=8, narch=16, ns=6, cap_bottom=False, cap_top=True,
               recess=0.35, mat_fill=M_BACK)
        for m in (-1, 1):
            tracery(bm, place_g, S / 2 + m * NICHE_S, 1.5, 8.6, 14.8 + 1.5, 0.338, arch=True, pt=0.35)
        for sgn in (-1, 1):
            s0, s1 = (S / 2 + PW, S) if sgn > 0 else (0.0, S / 2 - PW)
            n_ = 8
            lo = [place_g(s0 + (s1 - s0) * i / n_, DECK - 0.35, -0.2) for i in range(n_ + 1)]
            hi = [(p[0], p[1], DECK) for p in lo]
            bridge(bm, vrow(bm, lo), vrow(bm, hi), M_GOLD)
            top_o = [place_g(s0 + (s1 - s0) * i / n_, DECK, -0.2) for i in range(n_ + 1)]
            top_i = [place_g(s0 + (s1 - s0) * i / n_, DECK, 0.0) for i in range(n_ + 1)]
            bridge(bm, vrow(bm, top_o), vrow(bm, top_i), M_GOLD)
        # the lintel between the towers: gold fascia, a traced inscription
        ENT0, ENT1 = CROWN + 2.1, CROWN + 3.9
        TW_IN = 7.8                                   # the towers' inner faces
        tbox(bm, R_OUT - 0.3, R_OUT + 1.3, -TW_IN, TW_IN, ENT0, ENT1, M_STONE)
        tbox(bm, R_OUT + 1.28, R_OUT + 1.38, -TW_IN, TW_IN, ENT0, ENT0 + 0.3, M_GOLD)
        tbox(bm, R_OUT - 0.3, R_OUT + 1.5, -TW_IN - 0.2, TW_IN + 0.2, ENT1, ENT1 + 0.3, M_GOLD)

        def place_ins(s_, z, tt):
            return lp_(R_OUT + 1.31 + 0.02 * -tt, s_, z)
        poly(bm, [place_ins(-6.0, ENT0 + 0.45, 0), place_ins(6.0, ENT0 + 0.45, 0),
                  place_ins(6.0, ENT0 + 1.5, 0), place_ins(-6.0, ENT0 + 1.5, 0)], M_BACK)
        for g in range(13):
            s_ = -5.4 + 0.9 * g
            zc = ENT0 + 0.97
            if g % 3 == 0:
                glyph = [(s_ - 0.25, zc), (s_, zc + 0.35), (s_ + 0.25, zc), (s_, zc - 0.35)]
                line_strip(bm, place_ins, glyph, -2.0, 0.07, closed=True)
            else:
                line_strip(bm, place_ins, [(s_ - 0.2, zc - 0.3), (s_ + 0.2, zc + 0.3)], -2.0, 0.07)
                line_strip(bm, place_ins, [(s_, zc - 0.3), (s_, zc + 0.3)], -2.0, 0.07)
        # archivolt + jambs + keystone on the outer arch
        arcv = [Vector(lp_(R_OUT + 0.2, (PW + 0.45) * math.cos(math.pi * k / 24),
                           SPRING + (PW + 0.45) * math.sin(math.pi * k / 24))) for k in range(25)]
        tube_along(bm, arcv, 0.4, segs=8, mat=M_GOLD)
        for sgn in (-1, 1):
            tbox(bm, R_OUT - 0.05, R_OUT + 0.45, (PW + 0.1) * sgn - 0.3, (PW + 0.1) * sgn + 0.3,
                 DECK, SPRING, M_GOLD)
        tbox(bm, R_OUT - 0.1, R_OUT + 0.7, -0.9, 0.9, CROWN - 0.4, ENT0, M_STONE)
        diamond(bm, R_OUT + 0.72, 0.0, CROWN + 0.6, 1)
        # the medallion: dark field, traced rings, a gold star
        MED_Z, MED_R = ENT1 + 3.8, 3.0

        def place_med(s_, z, tt):
            return lp_(R_OUT + 0.08 + 0.02 * -tt, s_, z)
        disc = [place_med(math.cos(TAU * k / 32) * MED_R, MED_Z + math.sin(TAU * k / 32) * MED_R, 0)
                for k in range(32)]
        ctr = place_med(0.0, MED_Z, 0)
        for k in range(32):
            poly(bm, [disc[k], disc[(k + 1) % 32], ctr], M_BACK)
        line_strip(bm, place_med, [(math.cos(TAU * k / 32) * MED_R * 0.86, MED_Z + math.sin(TAU * k / 32) * MED_R * 0.86)
                                   for k in range(32)], -2.0, 0.12, closed=True)
        torus(bm, MED_R + 0.12, 0.34, major=40, minor=8, mat=M_GOLD, center=lp_(R_OUT + 0.12, 0.0, MED_Z), axis='X')
        star = []
        for kk in range(16):
            a = TAU * kk / 16 + math.pi / 2
            rr = 2.3 if kk % 2 == 0 else 0.9
            star.append(lp_(R_OUT + 0.22, math.cos(a) * rr, MED_Z + math.sin(a) * rr))
        ctr = lp_(R_OUT + 0.4, 0.0, MED_Z)
        for kk in range(16):
            poly(bm, [star[kk], star[(kk + 1) % 16], ctr], M_GOLD)
        # attic cornice, crest and finial
        ATT = TOP - 5.0
        tbox(bm, R_OUT - 0.2, R_OUT + 1.1, -S / 2 + 1.0, S / 2 - 1.0, ATT, ATT + 0.9, M_STONE)
        tbox(bm, R_OUT - 0.2, R_OUT + 1.2, -S / 2 + 1.0, S / 2 - 1.0, ATT + 0.9, ATT + 1.12, M_GOLD)
        tbox(bm, R_FAC - 0.2, R_OUT + 0.6, -S / 2 + 0.5, S / 2 - 0.5, TOP, TOP + 0.5, M_STONE, top=M_GOLD)
        tbox(bm, R_FAC + 0.2, R_OUT + 0.3, -8.0, 8.0, TOP + 0.5, TOP + 2.2, M_STONE, top=M_GOLD)
        tbox(bm, R_FAC + 0.5, R_OUT, -4.6, 4.6, TOP + 2.2, TOP + 3.9, M_STONE, top=M_GOLD)
        fz = TOP + 3.9
        lathe_c(bm, [(1.3, 0.0), (1.3, 0.4), (0.75, 0.9), (0.6, 2.8), (1.05, 3.4), (1.05, 3.7), (0.0, 3.8)],
                segs=12, mat=M_GOLD, origin=((R_FAC + R_OUT) / 2 - RMID, 0.0, fz), close_bottom=False)
        gem(bm, ((R_FAC + R_OUT) / 2 - RMID, 0.0, fz + 3.7), 1.4, 4.8)
        PL_D, PL_T = 2.2, 1.35
        for (z0p, z1p, o0, o1) in ((-PL_D, 0.0, 1.55, 1.55), (0.0, PL_T, 1.55, 0.30)):
            bridge(bm, vrow(bm, arc(R_OUT + o0, -HA, HA, z0p, N * 2)),
                   vrow(bm, arc(R_OUT + o1, -HA, HA, z1p, N * 2)), M_DARK)
        bridge(bm, vrow(bm, arc(R_OUT - WALL_T, -HA, HA, -PL_D, N * 2)),
               vrow(bm, arc(R_OUT + 1.55, -HA, HA, -PL_D, N * 2)), M_DARK, flip=True)

        # ---- twin drum towers on the seams, blue slate cones ------------------
        for sgn in (-1, 1):
            o = wp(R_OUT - 3.0, HA * sgn, 0.0)
            lathe_c(bm, [(4.6, 0.0), (4.6, 1.2), (4.2, 1.7), (4.2, 26.0), (4.9, 27.0),
                         (4.9, 28.4), (4.5, 29.0)], segs=24, mat=M_STONE, origin=o, close_top=False)
            lathe_c(bm, [(5.1, 29.0), (4.5, 31.4), (3.2, 36.0), (1.7, 41.0), (0.6, 45.0), (0.0, 46.6)],
                    segs=24, mat=M_ROOF, origin=o, close_bottom=True, smooth=True)
            torus(bm, 4.72, 0.18, major=28, minor=8, mat=M_GOLD, center=(o[0], o[1], 27.3))
            torus(bm, 5.02, 0.16, major=28, minor=6, mat=M_GOLD, center=(o[0], o[1], 29.05))
            lathe(bm, [(0.34, 0.0), (0.34, 0.6), (0.18, 1.8), (0.42, 2.2), (0.0, 3.6)],
                  segs=8, mat=M_GOLD, origin=(o[0], o[1], 46.2), close_bottom=False)
            for i in range(8):
                aa = TAU * i / 8
                lathe(bm, [(0.0, 0.0), (0.26, 0.05), (0.2, 0.26), (0.0, 0.44)], segs=10, mat=M_FLAME,
                      origin=(o[0] + math.cos(aa) * 4.6, o[1] + math.sin(aa) * 4.6, 24.2))
            for i in range(6):
                aa = TAU * i / 6
                for zs in (9.0, 16.5):
                    box(bm, (0.9, 0.14, 2.1),
                        center=(o[0] + math.cos(aa) * 4.22, o[1] + math.sin(aa) * 4.22, zs),
                        mat=M_RUNE, rot=Matrix.Rotation(aa, 3, 'Z'))

        # ---- the flanking towers: they stand out over the water, bannered ---
        T_R0, T_R1 = R_OUT, R_OUT + 6.0
        TT0, TT1 = TW_IN, TW_IN + 6.0
        T_TOP = 37.0
        for sgn in (-1, 1):
            t0, t1 = (TT0, TT1) if sgn > 0 else (-TT1, -TT0)
            tc = (t0 + t1) / 2
            tbox(bm, T_R0, T_R1, t0, t1, -18.0, DECK + 0.3, M_DARK, top=M_DARK)
            tbox(bm, T_R0 + 0.2, T_R1 - 0.2, t0 + 0.2, t1 - 0.2, DECK + 0.3, T_TOP, M_STONE)
            for (zb, h) in ((DECK + 0.3, 0.4), (ENT0, 0.45), (T_TOP - 3.2, 0.3)):
                tbox(bm, T_R0 + 0.12, T_R1 - 0.12, t0 + 0.12, t1 - 0.12, zb, zb + h, M_GOLD,
                     no_top=True)
            tbox(bm, T_R0 - 0.1, T_R1 + 0.1, t0 - 0.1, t1 + 0.1, T_TOP, T_TOP + 1.2, M_STONE, top=M_GOLD)
            # a square pyramid of blue slate
            apx = lp_((T_R0 + T_R1) / 2, tc, T_TOP + 11.0)
            h3 = 3.4
            cs_ = [lp_((T_R0 + T_R1) / 2 + dx, tc + dy, T_TOP + 1.2) for (dx, dy) in
                   ((-h3, -h3), (h3, -h3), (h3, h3), (-h3, h3))]
            for i in range(4):
                poly(bm, [cs_[i], cs_[(i + 1) % 4], apx], M_ROOF)
            lathe_c(bm, [(0.45, 0.0), (0.45, 0.6), (0.22, 2.0), (0.5, 2.5), (0.0, 3.8)], segs=8, mat=M_GOLD,
                    origin=(apx[0], apx[1], apx[2] - 0.3), close_bottom=False)
            gem(bm, (apx[0], apx[1], apx[2] + 3.3), 0.7, 2.6)

            # tracery up the front face and a big Tidehold banner over it
            def place_tf(s_, z, tt, t_c=tc):
                return lp_(T_R1 - 0.2 + 0.02 + 0.02 * -tt, t_c + s_, z)
            panel(bm, place_tf, 0.0, 1.3, DECK + 3.0, DECK + 13.0, 0.0, arch=True)
            tracery(bm, place_tf, 0.0, 1.3, DECK + 3.0, DECK + 13.0, -2.0, arch=True)
            banner(bm, lp_(T_R1 + 0.05, tc, T_TOP - 3.6), (0, 1, 0), (1, 0, 0), 3.8, 12.0, sway=0.2)

            # arrow slits in cyan on the outer face
            t_face = t1 if sgn > 0 else t0
            for zs in (DECK + 5.0, DECK + 14.0, DECK + 22.0):
                for rr in (T_R0 + 2.0, T_R0 + 4.0):
                    q = [lp_(rr - 0.07, t_face + 0.02 * sgn, zs), lp_(rr + 0.07, t_face + 0.02 * sgn, zs),
                         lp_(rr + 0.07, t_face + 0.02 * sgn, zs + 2.2), lp_(rr - 0.07, t_face + 0.02 * sgn, zs + 2.2)]
                    poly(bm, q, M_RUNE)

        # ---- the arrival terrace at the bridge deck ----------------------------
        TW = 7.6
        PIER_Z0 = -18.0
        tbox(bm, R_OUT - 0.2, R_TER, -TW, TW, PIER_Z0, DECK - 0.01, M_DARK)
        for (t0, t1, m) in ((-TW, -0.27, M_PAVE), (-0.27, -0.15, M_GOLD), (-0.15, 0.15, M_RUNE),
                            (0.15, 0.27, M_GOLD), (0.27, TW, M_PAVE)):
            quad(bm, lp_(R_OUT, t0, DECK), lp_(R_OUT, t1, DECK), lp_(R_TER, t1, DECK), lp_(R_TER, t0, DECK), m)
        BEA_R, BEA_T = R_TER - 1.1, 6.9
        for sgn in (-1, 1):
            tbox(bm, BEA_R - 1.05, BEA_R + 1.05, sgn * BEA_T - 1.05, sgn * BEA_T + 1.05,
                 DECK, DECK + 0.9, M_STONE, top=M_DARK)
            tbox(bm, BEA_R - 1.12, BEA_R + 1.12, sgn * BEA_T - 1.12, sgn * BEA_T + 1.12,
                 DECK + 0.9, DECK + 1.05, M_GOLD)
            beacon(bm, BEA_R, sgn * BEA_T, DECK + 1.05, h=14.0, w=2.0)

        # ---- authored collision --------------------------------------------
        boxes, ramps = [], []
        X = lambda r: r - RMID
        f1_lo, f1_hi = R_ST0 - RUN / 2, riser_r(LAND_K - 1) + RUN / 2
        f2_lo, f2_hi = riser_r(LAND_K) - RUN / 2, riser_r(N_RISE - 1) + RUN / 2
        ramps.append(cramp(X((R_FORE + f1_lo + 0.1) / 2), 0.0, (f1_lo + 0.1 - R_FORE) / 2, PW, FLOOR, FLOOR))
        # the stair's walking line: through the middle of every tread (feet
        # within half a riser of the stone), level across the landing
        ramps.append(cramp(X((f1_lo + f1_hi) / 2), 0.0, (f1_hi - f1_lo) / 2, PW, FLOOR, FLOOR + LAND_K * RISE))
        ramps.append(cramp(X((f1_hi + f2_lo) / 2), 0.0, (f2_lo - f1_hi) / 2, PW,
                           FLOOR + LAND_K * RISE, FLOOR + LAND_K * RISE))
        ramps.append(cramp(X((f2_lo + f2_hi) / 2), 0.0, (f2_hi - f2_lo) / 2, PW, FLOOR + LAND_K * RISE, DECK))
        ramps.append(cramp(X((f2_hi + R_OUT) / 2), 0.0, (R_OUT - f2_hi) / 2, PW, DECK, DECK))
        ramps.append(cramp(X((R_OUT - 0.3 + R_TER) / 2), 0.0, (R_TER - R_OUT + 0.3) / 2, TW, DECK, DECK))
        # the seating blocks: straight decks (their inner edge must stay
        # parallel to the canyon wall), each at the rake height of its own
        # middle line, not the wedge's centre line
        edges = [R_IN, 69.1, 74.8, 76.65, 81.4, R_PORTAL, 88.05, 89.9, 93.45, R_FAC]
        for ra, rb in zip(edges[:-1], edges[1:]):
            ti = t_in(ra)
            to = rb * math.tan(HA)
            if to - ti <= 0.1:
                continue
            tm = (ti + to) / 2
            for sgn in (-1, 1):
                ramps.append(cramp(X((ra + rb) / 2), sgn * tm, (rb - ra) / 2, (to - ti) / 2,
                                   rake_mid(math.hypot(ra, tm)) if rake_mid(math.hypot(ra, tm)) > 0 else 0.0,
                                   rake_mid(math.hypot(rb, tm))))
        # the outer facade, in arcs either side of the great arch, and over it
        a_arch = PW / (R_OUT - WALL_T / 2)
        for sgn in (-1, 1):
            for (p0, p1) in ((a_arch, (a_arch + HA) / 2), ((a_arch + HA) / 2, HA)):
                boxes.append(arc_box(R_OUT - WALL_T / 2, sgn * (p0 + p1) / 2, TOP / 2, WALL_T / 2,
                                     (p1 - p0) / 2 * (R_OUT - WALL_T / 2) * 1.02, TOP / 2))
        boxes.append(cbox(X(R_OUT - WALL_T / 2), 0.0, (CROWN + TOP) / 2, WALL_T / 2, PW, (TOP - CROWN) / 2))
        for sgn in (-1, 1):
            o = wp(R_OUT - 3.0, HA * sgn, 0.0)
            for rot in (0.0, math.pi / 4):
                boxes.append(cbox(o[0], o[1], 14.5, 4.4, 4.4, 14.5, ry=rot))
            boxes.append(cbox(X((R_PORTAL + R_FAC) / 2), sgn * (PW + BW) / 2, BLOCK_TOP / 2,
                              (R_FAC - R_PORTAL) / 2, (BW - PW) / 2, BLOCK_TOP / 2))
            # the flanking towers and the terrace beacons
            boxes.append(cbox(X((T_R0 + T_R1) / 2), sgn * (TT0 + TT1) / 2, (T_TOP + 12.0 - 18.0) / 2,
                              (T_R1 - T_R0) / 2, (TT1 - TT0) / 2, (T_TOP + 12.0 + 18.0) / 2))
            boxes.append(cbox(X(BEA_R), sgn * BEA_T, DECK + 8.0, 1.15, 1.15, 8.0))
            # canyon-mouth pedestals with their beacons
            boxes.append(cbox(X((PED_R0 + PED_R1) / 2), sgn * (PW + 1.4), (PED_H + 12.0) / 2,
                              (PED_R1 - PED_R0) / 2, 1.4, (PED_H + 12.0) / 2))
            # the canyon walls: sloped tops on the coping line, never an
            # invisible ledge over it
            t0, t1 = PW * sgn, CW * sgn
            boxes.append(sloped_box(PED_R1, 74.8, t0, t1, coping(PED_R1), coping(74.8)))
            boxes.append(cbox(X((74.8 + 76.65) / 2), sgn * (PW + CW) / 2, coping(75.5) / 2,
                              (76.65 - 74.8) / 2, (CW - PW) / 2, coping(75.5) / 2))
            boxes.append(sloped_box(76.65, R_PORTAL, t0, t1, coping(76.65), coping(R_PORTAL)))
            # the blocks' front parapet
            a_mid = (a_ped + HA) / 2
            boxes.append(arc_box(R_IN + PAR_T / 2, sgn * a_mid, (PAR_H + 0.14) / 2, PAR_T / 2 + 0.08,
                                 (HA - a_ped) / 2 * R_IN * 1.02, (PAR_H + 0.14) / 2))
        COLL["arena_gatehouse"] = dict(boxes=boxes, ramps=ramps)
        LOG.append(f"gatehouse stair: {N_RISE} risers of {RISE:.3f}, runs {RUN:.3f}, landing "
                   f"{riser_r(LAND_K - 1):.2f}->{riser_r(LAND_K):.2f} at y {FLOOR + LAND_K * RISE:.2f}")

        weld(bm)
        apply_uvs(bm, RMID)
        return new_obj("arena_gatehouse", bm, MATS)

    # =======================================================================
    #  FLOOR, one 22.5-degree slice of the paved ground, axis to stands
    # =======================================================================
    RF0, RF1 = 3.5, 63.9
    CH_R0, CH_R1 = 34.3, 36.2          # the tide channel
    CH_FLOOR, CH_WATER = 0.15, 0.30

    def build_floor(gate=False):
        """`gate`: the wedge on the processional axis, with the runner from the
        stair's foot to the pylons and a bridge over the tide channel."""
        bm = bmesh.new()
        global RMID
        keep, RMID = RMID, (RF0 + RF1) / 2.0
        try:
            UP = 0.03
            bands = [(RF0, 3.9, M_GOLD, 0.0), (3.9, 21.8, 'ley', 0.0), (21.8, 22.8, M_GOLD, UP),
                     (22.8, 29.2, M_TEAL, 0.0), (29.2, 29.7, M_GOLD, 0.0), (29.7, 34.0, M_PAVE, 0.0),
                     (34.0, CH_R0, M_GOLD, 0.08), (CH_R0, CH_R1, 'channel', 0.0), (CH_R1, 36.5, M_GOLD, 0.08),
                     (36.5, 51.4, M_PAVE, 0.0), (51.4, 52.4, M_GOLD, UP), (52.4, 58.9, M_PAVE_DK, 0.0),
                     (58.9, 59.3, M_GOLD, 0.0), (59.3, RF1, M_PAVE_DK, 0.0)]
            for (r0, r1, m, lift) in bands:
                nr = max(1, int(math.ceil((r1 - r0) / 1.6)))
                rs = [r0 + (r1 - r0) * i / nr for i in range(nr + 1)]
                if m == 'ley':
                    NSIDE = max(2, int(r1 * HA / 1.2))

                    def cols(r):
                        g, c = 0.07 / r, 0.1 / r
                        side = [(-HA + g) + ((-c) - (-HA + g)) * i / NSIDE for i in range(NSIDE + 1)]
                        return ([-HA] + side + [c + (HA - g - c) * i / NSIDE for i in range(NSIDE + 1)] + [HA],
                                [M_GOLD] + [M_PAVE] * NSIDE + [M_RUNE] + [M_PAVE] * NSIDE + [M_GOLD])
                    for i in range(nr):
                        ca, mats_ = cols(rs[i])
                        cb, _ = cols(rs[i + 1])
                        for j in range(len(ca) - 1):
                            poly(bm, [wp(rs[i], ca[j], FLOOR), wp(rs[i], ca[j + 1], FLOOR),
                                      wp(rs[i + 1], cb[j + 1], FLOOR), wp(rs[i + 1], cb[j], FLOOR)], mats_[j])
                    continue
                na = max(2, int(r1 * WSPAN / 1.4))
                if m == 'channel':
                    # the water, a hand below the kerbs; the channel walls are
                    # the kerbs' inner faces
                    for i in range(nr):
                        bridge(bm, vrow(bm, arc(rs[i], -HA, HA, CH_WATER, na)),
                               vrow(bm, arc(rs[i + 1], -HA, HA, CH_WATER, na)), M_TIDE, flip=True)
                    for rr in (r0, r1):
                        bridge(bm, vrow(bm, arc(rr, -HA, HA, CH_FLOOR, na)),
                               vrow(bm, arc(rr, -HA, HA, FLOOR + 0.08, na)), M_TEAL)
                    continue
                y = FLOOR + lift
                for i in range(nr):
                    bridge(bm, vrow(bm, arc(rs[i], -HA, HA, y, na)),
                           vrow(bm, arc(rs[i + 1], -HA, HA, y, na)), m, flip=True)
                if lift > 0:
                    for rr in (r0, r1):
                        if abs(rr - CH_R0) < 1e-6 or abs(rr - CH_R1) < 1e-6:
                            continue          # the channel's own wall stands here
                        bridge(bm, vrow(bm, arc(rr, -HA, HA, FLOOR, na)),
                               vrow(bm, arc(rr, -HA, HA, y, na)), m)
            bridge(bm, vrow(bm, arc(RF1, -HA, HA, FLOOR, 16)), vrow(bm, arc(RF1, -HA, HA, -0.6, 16)), M_DARK)
            lathe_c(bm, [(1.58, FLOOR - 0.02), (1.6, FLOOR + 0.1), (1.76, FLOOR + 0.15),
                         (1.96, FLOOR + 0.1), (1.98, FLOOR - 0.02)], segs=32, mat=M_GOLD,
                    close_bottom=False, close_top=False, origin=(CRADLE_R - RMID, 0.0, 0.0))
            ramps = rake_like_floor_decks()
            if gate:
                # the runner: slate between gold borders, a cyan spine, 4 cm
                # proud; a bridge over the channel with low gold rails
                RUN_HW = 3.0
                cols = [(-RUN_HW, -2.5, M_GOLD), (-2.5, -0.15, M_SLATE), (-0.15, 0.15, M_RUNE),
                        (0.15, 2.5, M_SLATE), (2.5, RUN_HW, M_GOLD)]
                RY = FLOOR + 0.04
                BY = FLOOR + 0.1                  # the bridge clears the kerbs (0.48)
                for (ra, rb, y) in ((29.7, 34.0, RY), (34.0, 36.5, BY), (36.5, RF1, RY)):
                    for (t0, t1, m) in cols:
                        quad(bm, lp_(ra, t0, y), lp_(ra, t1, y), lp_(rb, t1, y), lp_(rb, t0, y), m)
                    for t_ in (-RUN_HW, RUN_HW):
                        quad(bm, lp_(ra, t_, FLOOR - 0.02 if (ra, rb) != (34.0, 36.5) else CH_FLOOR),
                             lp_(rb, t_, FLOOR - 0.02 if (ra, rb) != (34.0, 36.5) else CH_FLOOR),
                             lp_(rb, t_, y), lp_(ra, t_, y), M_GOLD)
                quad(bm, lp_(29.7, -RUN_HW, FLOOR), lp_(29.7, RUN_HW, FLOOR),
                     lp_(29.7, RUN_HW, RY), lp_(29.7, -RUN_HW, RY), M_GOLD)
                for sgn in (-1, 1):
                    tbox(bm, 34.0, 36.5, sgn * RUN_HW - 0.12, sgn * RUN_HW + 0.12, BY, BY + 0.32, M_GOLD)
                ramps.append(cramp((34.0 + 36.5) / 2 - RMID, 0.0, (36.5 - 34.0) / 2, RUN_HW, BY, BY))
            COLL["arena_floor_gate" if gate else "arena_floor"] = dict(boxes=[], ramps=ramps)
            weld(bm, 1e-4)
            apply_uvs(bm, RMID)
            ob = new_obj("arena_floor_gate" if gate else "arena_floor", bm, MATS)
        finally:
            RMID = keep
        return ob

    def rake_like_floor_decks():
        """Three rotated slices per ring band: flat floor, the channel a
        quarter-yard down."""
        out = []
        for (a, b, y) in ((RF0 - 0.3, 22.0, FLOOR), (22.0, CH_R0, FLOOR), (CH_R0, CH_R1, CH_FLOOR),
                          (CH_R1, RF1, FLOOR)):
            for th in (-2 * SLICE, 0.0, 2 * SLICE):
                rm = (a + b) / 2
                hz = b * math.tan(SLICE) + 0.25
                out.append(cramp(rm * math.cos(th) - RMID, rm * math.sin(th), (b - a) / 2, hz, y, y, ry=th))
        return out

    def build_floor_core():
        """The disc under the bell's lowest point: gold star, cyan ring."""
        bm = bmesh.new()
        R_STAR_O, R_STAR_I = 2.3, 0.95
        rings = [(2.55, 2.85, M_RUNE), (2.85, 3.5, M_SLATE), (3.5, 3.95, M_GOLD)]
        star = []
        for k in range(16):
            a = TAU * k / 16 + math.pi / 16
            rr = R_STAR_O if k % 2 == 0 else R_STAR_I
            star.append((math.cos(a) * rr, math.sin(a) * rr, FLOOR))
        for k in range(16):
            poly(bm, [star[k], star[(k + 1) % 16], (0.0, 0.0, FLOOR + 0.012)], M_GOLD)
        NS = 4
        for k in range(16):
            a0 = TAU * k / 16 + math.pi / 16
            a1 = TAU * (k + 1) / 16 + math.pi / 16
            p0 = Vector(star[k])
            p1 = Vector(star[(k + 1) % 16])
            for j in range(NS):
                u0, u1 = j / NS, (j + 1) / NS
                s0 = p0.lerp(p1, u0)
                s1 = p0.lerp(p1, u1)
                c0 = (math.cos(a0 + (a1 - a0) * u0) * 2.55, math.sin(a0 + (a1 - a0) * u0) * 2.55, FLOOR)
                c1 = (math.cos(a0 + (a1 - a0) * u1) * 2.55, math.sin(a0 + (a1 - a0) * u1) * 2.55, FLOOR)
                poly(bm, [tuple(s0), tuple(s1), c1, c0][::-1], M_SLATE)
        for (r0, r1, m) in rings:
            lo = [(math.cos(TAU * i / 64 + math.pi / 16) * r0, math.sin(TAU * i / 64 + math.pi / 16) * r0, FLOOR)
                  for i in range(65)]
            hi = [(math.cos(TAU * i / 64 + math.pi / 16) * r1, math.sin(TAU * i / 64 + math.pi / 16) * r1, FLOOR)
                  for i in range(65)]
            bridge(bm, vrow(bm, lo), vrow(bm, hi), m, flip=True)
        COLL["arena_floor_core"] = dict(boxes=[], ramps=[cramp(0, 0, 4.0, 4.0, FLOOR, FLOOR)])
        weld(bm, 1e-4)
        apply_uvs(bm, None)
        return new_obj("arena_floor_core", bm, MATS)

    # =======================================================================
    #  BELL FRAME, the gold collar, ribs, latitude rings and crown
    # =======================================================================
    # Origin at the bell's CENTRE (DEEPGLASS_CENTER), +Z up. Render dressing
    # only (deepglass_kit.ts). The ribs stand on the odd sixteenths so neither
    # goal hole (on the +-X axis, 9.6 degrees across, its housing ~14) is ever
    # crossed; the latitude rings at +-30 degrees clear both.
    CROWN_TIP = R_BELL + 24.2      # mirrored in src/render/deepglass.ts CROWN_TIP_Y

    def build_bell_frame():
        bm = bmesh.new()
        RB = R_BELL
        OFF0, OFF1 = RB + 0.12, RB + 0.72
        z_col = -math.sqrt(RB * RB - 26.3 * 26.3)
        lathe(bm, [(25.4, z_col - 1.45), (26.9, z_col - 1.45), (27.45, z_col - 0.9),
                   (27.45, z_col + 0.55), (27.0, z_col + 0.95), (26.0, z_col + 0.95)],
              segs=96, mat=M_GOLD, close_bottom=False, close_top=False)
        lathe(bm, [(27.48, z_col - 0.14), (27.48, z_col + 0.14)], segs=96, mat=M_RUNE,
              close_bottom=False, close_top=False, smooth=False)
        for k in range(16):
            a = TAU * k / 16
            lathe(bm, [(0.0, -0.55), (0.42, -0.4), (0.55, 0.0), (0.42, 0.4), (0.0, 0.55)], segs=10,
                  mat=M_GOLD, origin=(math.cos(a) * 27.5, math.sin(a) * 27.5, z_col))
        # latitude rings at +-30 degrees
        for sgn in (-1, 1):
            zc = sgn * RB * math.sin(math.radians(30))
            rh = math.sqrt(RB * RB - zc * zc)
            lathe(bm, [(rh + 0.1, zc - 0.75), (rh + 0.6, zc - 0.7), (rh + 0.7, zc - 0.4),
                       (rh + 0.7, zc + 0.4), (rh + 0.6, zc + 0.7), (rh + 0.1, zc + 0.75)],
                  segs=128, mat=M_GOLD, close_bottom=False, close_top=False)
            lathe(bm, [(rh + 0.72, zc - 0.13), (rh + 0.72, zc + 0.13)], segs=128, mat=M_RUNE,
                  close_bottom=False, close_top=False, smooth=False)
        R_CROWN = 14.5
        a_lo = math.asin(27.2 / RB)
        a_hi = math.pi - math.asin(R_CROWN / RB)
        NSAMP = 90
        for kk in range(8):
            phi = WSPAN / 2 + kk * TAU / 8
            ring_pts = []
            for i in range(NSAMP + 1):
                al = a_lo + (a_hi - a_lo) * i / NSAMP
                n = Vector((math.sin(al) * math.cos(phi), math.sin(al) * math.sin(phi), -math.cos(al)))
                b = Vector((-math.sin(phi), math.cos(phi), 0.0))
                hw = 1.2 - 0.6 * (i / NSAMP)          # tapers 2.4 -> 1.2 yd wide
                ring_pts.append((n, b, hw))
            for i in range(NSAMP):
                (n0, b0, h0), (n1, b1, h1) = ring_pts[i], ring_pts[i + 1]
                cols = [(-1.0, M_GOLD), (-0.2, M_RUNE), (0.2, M_GOLD), (1.0, None)]
                for j in range(3):
                    w0, m = cols[j]
                    w1 = cols[j + 1][0]
                    poly(bm, [tuple(n0 * OFF1 + b0 * w0 * h0), tuple(n1 * OFF1 + b1 * w0 * h1),
                              tuple(n1 * OFF1 + b1 * w1 * h1), tuple(n0 * OFF1 + b0 * w1 * h0)], m)
                poly(bm, [tuple(n0 * OFF0 + b0 * h0), tuple(n1 * OFF0 + b1 * h1),
                          tuple(n1 * OFF0 - b1 * h1), tuple(n0 * OFF0 - b0 * h0)], M_GOLD)
                for sg in (-1, 1):
                    q = [tuple(n0 * OFF0 + b0 * h0 * sg), tuple(n1 * OFF0 + b1 * h1 * sg),
                         tuple(n1 * OFF1 + b1 * h1 * sg), tuple(n0 * OFF1 + b0 * h0 * sg)]
                    poly(bm, q if sg > 0 else q[::-1], M_GOLD)
        zc = RB * math.cos(math.asin(R_CROWN / RB))
        torus(bm, R_CROWN + 0.3, 0.8, major=72, minor=12, mat=M_GOLD, center=(0, 0, zc + 0.3))
        torus(bm, R_CROWN + 0.3, 0.26, major=72, minor=6, mat=M_RUNE, center=(0, 0, zc + 1.15))
        for kk in range(8):
            phi = WSPAN / 2 + kk * TAU / 8
            c, s = math.cos(phi), math.sin(phi)
            pts, rad = [], []
            for i in range(15):
                u = i / 14
                r = (1 - u) ** 2 * (R_CROWN + 0.3) + 2 * (1 - u) * u * 12.5 + u * u * 2.2
                z = (1 - u) ** 2 * (zc + 0.6) + 2 * (1 - u) * u * (RB + 10.0) + u * u * (RB + 13.2)
                pts.append(Vector((c * r, s * r, z)))
                rad.append(0.62 - 0.34 * u)
            tube_along(bm, pts, 0.62, segs=8, mat=M_GOLD, radii=rad)
        lathe(bm, [(0.0, RB - 0.3), (3.6, RB + 0.2), (2.2, RB + 3.4), (1.4, RB + 8.0),
                   (2.6, RB + 12.3), (3.1, RB + 13.2), (0.0, RB + 13.5)], segs=24, mat=M_GOLD)
        gem(bm, (0, 0, RB + 13.2), 2.7, CROWN_TIP - RB - 13.2, segs=8)
        torus(bm, 3.6, 0.2, major=32, minor=6, mat=M_GOLD, center=(0, 0, RB + 16.5))
        weld(bm, 1e-4)
        apply_uvs(bm, None)
        return new_obj("bell_frame", bm, MATS)

    # =======================================================================
    #  CANOPY, the awning over the top terrace: slate, gold, banners
    # =======================================================================
    def build_canopy():
        bm = bmesh.new()
        N = 16
        global RMID
        RI, RO = R_OUT - 20.0, R_OUT + 2.2
        keep, RMID = RMID, (RI + RO) / 2.0
        try:
            def shell_z(u):
                return 4.2 + 7.4 * (u ** 0.72)
            NS = 10
            rows_b, rows_t = [], []
            for i in range(NS + 1):
                u = i / NS
                r = RI + (RO - RI) * u
                z = shell_z(u)
                rows_b.append(arc(r, -HA, HA, z, N))
                rows_t.append(arc(r, -HA, HA, z + 0.34, N))
            for i in range(NS):
                bridge(bm, vrow(bm, rows_t[i]), vrow(bm, rows_t[i + 1]), M_ROOF_SL, smooth=True, flip=True)
                bridge(bm, vrow(bm, rows_b[i]), vrow(bm, rows_b[i + 1]), M_DARK, smooth=True)
            bridge(bm, vrow(bm, rows_b[0]), vrow(bm, rows_t[0]), M_GOLD)
            bridge(bm, vrow(bm, rows_b[NS]), vrow(bm, rows_t[NS]), M_GOLD, flip=True)
            for j in range(4):
                a = -HA + WSPAN * (j + 0.5) / 4
                pts = [Vector(wp(RI + (RO - RI) * i / NS, a, shell_z(i / NS) + 0.38)) for i in range(NS + 1)]
                tube_along(bm, pts, 0.12, segs=5, mat=M_GOLD)
            lip = arc(RI + 0.4, -HA, HA, shell_z(0.02) - 0.02, N)
            bridge(bm, vrow(bm, lip), vrow(bm, arc(RI + 0.8, -HA, HA, shell_z(0.04) - 0.02, N)), M_RUNE)
            for sgn, idx in ((-1, 0), (1, N)):
                pts_b = [rows_b[i][idx] for i in range(NS + 1)]
                pts_t = [rows_t[i][idx] for i in range(NS + 1)]
                bridge(bm, vrow(bm, pts_b), vrow(bm, pts_t), M_DARK, flip=(sgn > 0))
            for j in range(3):
                a = -HA + WSPAN * (j + 0.5) / 3
                p0 = Vector(wp(RO - 0.6, a, shell_z(1.0) - 0.1))
                p1 = Vector(wp(RI + 1.2, a, shell_z(0.06) - 0.2))
                p2 = Vector(wp(R_OUT - 1.6, a, 0.22))
                tube_along(bm, [p1, (p1 + p2) * 0.5 + Vector((0, 0, -0.6)), p2], 0.26, segs=8, mat=M_GOLD)
                tube_along(bm, [p0, (p0 + p1) * 0.5, p1], 0.17, segs=6, mat=M_GOLD)
            # two drops off the lip over the top rows, facing the bell
            for a in (-HA * 0.5, HA * 0.5):
                o = Vector(wp(RI + 0.35, a, shell_z(0.0) - 0.05))
                right = Vector((-math.sin(a), math.cos(a), 0.0))
                banner(bm, tuple(o), tuple(right), (-math.cos(a), -math.sin(a), 0.0), 2.2, 4.6, sway=0.12)
            COLL["arena_canopy"] = dict(boxes=[
                arc_box(RO - 0.5, -HA + WSPAN * (j + 0.5) / 3, shell_z(1.0) + 0.17, 0.5,
                        (WSPAN / 6) * RO * 1.02, 0.34)
                for j in range(3)
            ], ramps=[])
            weld(bm)
            apply_uvs(bm, RMID)
            ob = new_obj("arena_canopy", bm, MATS)
        finally:
            RMID = keep
        return ob

    # =======================================================================
    #  small pieces, origin at their own foot, +X outward
    # =======================================================================
    def small(tag, bm):
        weld(bm)
        apply_uvs(bm, None)
        return new_obj(tag, bm, MATS)

    def build_brazier():
        bm = bmesh.new()
        lathe_c(bm, [(1.05, 0.0), (1.05, 0.34), (0.92, 0.46), (0.92, 0.60), (0.74, 0.74)],
                segs=14, mat=M_DARK, smooth=False, close_top=False)
        lathe_c(bm, [(0.74, 0.74), (0.62, 1.10), (0.50, 3.40), (0.44, 5.60), (0.52, 6.05), (0.46, 6.25)],
                segs=20, mat=M_STONE, close_bottom=False, close_top=False)
        for i in range(4):
            a = TAU * i / 4 + math.pi / 4
            tube_along(bm, [Vector((math.cos(a) * 0.46, math.sin(a) * 0.46, 6.25)),
                            Vector((math.cos(a) * 0.86, math.sin(a) * 0.86, 6.95)),
                            Vector((math.cos(a) * 0.74, math.sin(a) * 0.74, 7.55))], 0.085, segs=6, mat=M_GOLD)
        torus(bm, 0.78, 0.10, major=24, minor=8, mat=M_GOLD, center=(0, 0, 7.55))
        lathe(bm, [(0.0, 0.0), (0.74, 0.10), (0.80, 0.55), (0.60, 0.95), (0.0, 1.15)],
              segs=22, mat=M_FLAME, origin=(0, 0, 7.55))
        torus(bm, 0.56, 0.075, major=20, minor=6, mat=M_GOLD, center=(0, 0, 3.3))
        torus(bm, 0.5, 0.06, major=20, minor=6, mat=M_GOLD, center=(0, 0, 5.62))
        COLL["arena_brazier"] = dict(boxes=[cbox(0, 0, 3.5, 0.85, 0.85, 3.5)], ramps=[])
        return small("arena_brazier", bm)

    def build_banner():
        bm = bmesh.new()
        box(bm, (0.42, 0.42, 1.3), center=(0, 0, 0.65), mat=M_DARK)
        tube_along(bm, [Vector((0, 0, 1.25)), Vector((0, 0, 6.4))], 0.13, segs=8, mat=M_GOLD)
        banner(bm, (0.0, 0.0, 6.25), (0, 1, 0), (1, 0, 0), 2.7, 4.9, sway=0.3)
        COLL["arena_banner"] = dict(boxes=[cbox(0, 0, 0.8, 0.28, 0.28, 0.8)], ramps=[])
        return small("arena_banner", bm)

    def build_pennant():
        bm = bmesh.new()
        lathe(bm, [(0.68, 0.0), (0.68, 0.40), (0.52, 0.56)], segs=12, mat=M_DARK, close_top=False)
        tube_along(bm, [Vector((0, 0, 0.5)), Vector((0, 0, 15.5))], 0.17, segs=8, mat=M_GOLD, radii=[0.20, 0.09])
        gem(bm, (0, 0, 15.3), 0.26, 0.9)
        NW, NH = 10, 6
        prev = None
        for j in range(NH + 1):
            v = j / NH
            row = []
            for i in range(NW + 1):
                u = i / NW
                z = 14.6 - 2.5 * v
                y = u * (4.4 * (1.0 - 0.55 * v))
                x = 0.34 * math.sin(u * 3.1) * (u ** 0.8)
                row.append((x, y, z - 0.5 * u))
            vr = vrow(bm, row)
            if prev:
                bridge(bm, prev, vr, M_CLOTH, smooth=True)
            prev = vr
        COLL["arena_pennant"] = dict(boxes=[cbox(0, 0, 0.9, 0.55, 0.55, 0.9)], ramps=[])
        return small("arena_pennant", bm)

    def build_scoreboard():
        bm = bmesh.new()
        for sgn in (-1, 1):
            box(bm, (1.5, 1.5, 9.0), center=(0, sgn * 4.6, 4.5), mat=M_STONE)
            box(bm, (2.3, 2.3, 0.7), center=(0, sgn * 4.6, 0.35), mat=M_DARK)
            box(bm, (1.62, 1.62, 0.24), center=(0, sgn * 4.6, 8.2), mat=M_GOLD)
        box(bm, (1.1, 11.0, 0.8), center=(0, 0, 9.3), mat=M_GOLD)
        box(bm, (0.9, 10.2, 5.4), center=(0, 0, 12.4), mat=M_DARK)
        box(bm, (0.16, 9.3, 4.5), center=(0.5, 0, 12.4), mat=M_BACK)

        def place_sb(s_, z, tt):
            return (0.6 + 0.01 * -tt, s_, z)
        # the two sides' marks and a lozenge between them, in rune light
        for m in (-1, 1):
            s_c = m * 2.4
            line_strip(bm, place_sb, [(s_c - 0.9, 11.0), (s_c - 0.9, 13.8), (s_c + 0.9, 13.8), (s_c + 0.9, 11.0)],
                       0.5, 0.16, closed=True)
        line_strip(bm, place_sb, [(0, 11.4), (0.6, 12.4), (0, 13.4), (-0.6, 12.4)], 0.5, 0.12, closed=True)
        line_strip(bm, place_sb, [(-4.4, 10.5), (4.4, 10.5)], 0.5, 0.08)
        box(bm, (1.2, 11.4, 0.55), center=(0, 0, 15.35), mat=M_GOLD)
        for i in range(5):
            y = -4.0 + 2.0 * i
            tube_along(bm, [Vector((0.62, y, 9.8)), Vector((0.62, y, 10.05))], 0.06, segs=6, mat=M_GOLD)
        for sgn in (-1, 1):
            tube_along(bm, [Vector((0, sgn * 4.6, 8.4)), Vector((0, sgn * 3.1, 9.6))], 0.11, segs=6, mat=M_GOLD)
        COLL["arena_scoreboard"] = dict(boxes=[
            cbox(0, -4.6, 4.7, 1.15, 1.15, 4.7),
            cbox(0, 4.6, 4.7, 1.15, 1.15, 4.7),
            cbox(0, 0, 12.5, 0.6, 5.7, 3.2),
        ], ramps=[])
        return small("arena_scoreboard", bm)

    def build_box():
        bm = bmesh.new()
        W, D, H = 12.0, 7.0, 3.6
        box(bm, (D, W, 0.55), center=(0, 0, 0.275), mat=M_STONE)
        for i in range(5):
            y = -W / 2 + 0.9 + (W - 1.8) * i / 4
            lathe(bm, [(0.34, 0.0), (0.30, 0.25), (0.26, H - 0.5), (0.32, H - 0.25), (0.26, H)],
                  segs=12, mat=M_STONE, origin=(D / 2 - 0.7, y, 0.55))
            torus(bm, 0.3, 0.05, major=12, minor=5, mat=M_GOLD, center=(D / 2 - 0.7, y, 0.55 + H - 0.3))
        box(bm, (0.7, W, H), center=(-D / 2 + 0.35, 0, 0.55 + H / 2), mat=M_DARK)
        for sgn in (-1, 1):
            box(bm, (D, 0.6, H), center=(0, sgn * (W / 2 - 0.3), 0.55 + H / 2), mat=M_DARK)
        box(bm, (0.42, W, 0.28), center=(D / 2 - 0.2, 0, 0.55 + 0.9), mat=M_GOLD)
        for i in range(17):
            y = -W / 2 + 0.5 + (W - 1.0) * i / 16
            lathe(bm, [(0.13, 0.0), (0.09, 0.18), (0.13, 0.42), (0.08, 0.62), (0.12, 0.8)],
                  segs=8, mat=M_STONE, origin=(D / 2 - 0.2, y, 0.55))
        NR = 10
        prev_a = prev_b = None
        for i in range(NR + 1):
            u = i / NR
            x = -D / 2 + D * u
            z = 0.55 + H + 0.35 + 1.5 * math.sin(u * math.pi) ** 0.9
            ra = vrow(bm, [(x, -W / 2 - 0.5, z), (x, W / 2 + 0.5, z)])
            rb = vrow(bm, [(x, -W / 2 - 0.5, z - 0.3), (x, W / 2 + 0.5, z - 0.3)])
            if prev_a:
                bridge(bm, prev_a, ra, M_ROOF, smooth=True, flip=True)
                bridge(bm, prev_b, rb, M_DARK, smooth=True)
            prev_a, prev_b = ra, rb
        for i in range(3):
            gem(bm, (0, -3.6 + 3.6 * i, 0.55 + H + 2.0), 0.24, 0.7)
        COLL["arena_box"] = dict(boxes=[
            cbox(-D / 2 + 0.35, 0, 0.55 + H / 2, 0.35, W / 2, H / 2),
            cbox(0, -(W / 2 - 0.3), 0.55 + H / 2, D / 2, 0.3, H / 2),
            cbox(0, W / 2 - 0.3, 0.55 + H / 2, D / 2, 0.3, H / 2),
            cbox(D / 2 - 0.2, 0, 0.55 + 0.52, 0.21, W / 2, 0.52),
        ], ramps=[cramp(0, 0, D / 2, W / 2, 0.55, 0.55)])
        return small("arena_box", bm)

    # =======================================================================
    BUILDERS = {
        'stand': lambda: build_stand(False),
        'vom': lambda: build_stand(True),
        'gatehouse': build_gatehouse,
        'canopy': build_canopy,
        'floor': lambda: build_floor(False),
        'floor_gate': lambda: build_floor(True),
        'floor_core': build_floor_core,
        'bell_frame': build_bell_frame,
        'brazier': build_brazier,
        'banner': build_banner,
        'box': build_box,
        'scoreboard': build_scoreboard,
        'pennant': build_pennant,
    }
    TAG = {'stand': 'arena_stand', 'vom': 'arena_stand_vom',
           'gatehouse': 'arena_gatehouse', 'canopy': 'arena_canopy',
           'floor': 'arena_floor', 'floor_gate': 'arena_floor_gate', 'floor_core': 'arena_floor_core',
           'bell_frame': 'bell_frame',
           'brazier': 'arena_brazier', 'banner': 'arena_banner', 'box': 'arena_box',
           'scoreboard': 'arena_scoreboard', 'pennant': 'arena_pennant'}

    made = []
    for key in BUILDERS:
        if key not in WANT:
            continue
        ob = BUILDERS[key]()
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        dx = max(p.x for p in bb) - min(p.x for p in bb)
        dy = max(p.y for p in bb) - min(p.y for p in bb)
        dz = max(p.z for p in bb) - min(p.z for p in bb)
        used = sorted({p.material_index for p in ob.data.polygons})
        LOG.append(f"{TAG[key]}: verts={len(ob.data.vertices)} "
                   f"tris={sum(len(p.vertices) - 2 for p in ob.data.polygons)} "
                   f"dim=({dx:.3f},{dy:.3f},{dz:.3f}) maxdim={max(dx, dy, dz):.3f} "
                   f"zmin={min(p.z for p in bb):.3f} mats={[MATS[i].name for i in used]}")
        c = COLL.get(TAG[key])
        if c is not None:
            side = {"size": [r4(dx), r4(dz), r4(dy)],   # glTF frame
                    "minY": 0,   # authoredGroundLine: this kit seats on its origin
                    "boxes": c["boxes"], "ramps": c["ramps"]}
            with open(f"{OUT_DIR}/{TAG[key]}.collision.json", "w") as fh:
                json.dump(side, fh, indent=1)
            LOG.append(f"  collision: {len(c['boxes'])} boxes, {len(c['ramps'])} decks")
        made.append((key, ob))

    # ---- headless Cycles previews -----------------------------------------
    if PREVIEW:
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = int(os.environ.get('ARENA_SAMPLES', '24'))
        sc.render.resolution_x, sc.render.resolution_y = 1280, 800
        studio_lights()
        world = sc.world
        world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.7, 0.85, 1)
        world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.2
        sun = bpy.data.lights.new("sun", 'SUN')
        sun.energy = 3.2
        so = bpy.data.objects.new("sun", sun)
        so.rotation_euler = (math.radians(52), 0, math.radians(-35))
        sc.collection.objects.link(so)
        cam_d = bpy.data.cameras.new("cam")
        cam = bpy.data.objects.new("cam", cam_d)
        sc.collection.objects.link(cam)
        sc.camera = cam
        SHOTS = {
            'gate_out': ('gatehouse', (R_OUT + 34.0 - RMID, 20.0, 14.0), (R_OUT - RMID, 0.0, 17.0), 50),
            'gate_in': ('gatehouse', (R_IN - 14.0 - RMID, 6.0, 5.0), (92.0 - RMID, 0.0, 10.0), 55),
            'gate_top': ('gatehouse', (R_IN - 20.0 - RMID, 45.0, 55.0), (84.0 - RMID, 0.0, 8.0), 50),
            'hall': ('gatehouse', (R_OUT + 3 - RMID, 1.5, 8.0), (70.0 - RMID, 0.0, 4.0), 72),
            'stand': ('stand', (R_IN - 25.0 - RMID, 10.0, 12.0), (0.0, 0.0, 12.0), 55),
            'stand_out': ('stand', (R_OUT + 30.0 - RMID, -14.0, 14.0), (R_OUT - RMID, 0.0, 12.0), 50),
            'floor': ('floor', (-45.0, -14.0, 26.0), (0.0, 0.0, 0.0), 55),
            'bell': ('bell_frame', (0.0, -190.0, 20.0), (0.0, 0.0, 0.0), 45),
        }
        byk = dict(made)
        for name in PREVIEW:
            if name not in SHOTS:
                continue
            (piece, cp, tg, fov) = SHOTS[name]
            for (k2, o2) in made:
                o2.hide_render = (k2 != piece)
            cam.location = Vector(cp)
            d = Vector(tg) - Vector(cp)
            cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
            cam_d.lens_unit = 'FOV'
            cam_d.angle = math.radians(fov)
            sc.render.filepath = f"{OUT_DIR}/preview_{name}.png"
            bpy.ops.render.render(write_still=True)
            LOG.append("shot " + name)

    if DO_EXPORT:
        for (key, ob) in made:
            tag = TAG[key]
            export_glb([ob], f"{OUT_DIR}/{tag}.glb")
            LOG.append(f"exported {tag}.glb")
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
