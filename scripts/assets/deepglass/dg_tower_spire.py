# Deepglass warden SPIRE tower, v2, a tall tower HOUSE in the warden kit's
# palette (mottled stone, dark socle, brass straps, cyan rune conduits, warm-lit
# windows, navy slate, dark timber): a chamfered socle and stone ground storey
# with the arched porch door; two JETTIED stone storeys on raking timber
# brackets, the first with a bay window under its own slate hood, the second
# with a steep gabled wing over the front and a timber balcony + hoist on the
# right; a hipped slate skirt; a round timber-corbelled drum with rune conduits
# and arched windows; a steep cone of scalloped slates with two dormers, a stone
# chimney with an iron flue, rafter tails under every eave, and a brass finial.
#
# Envelope: ~23.6 tall (Z), ~8 across at the eaves (X/Y), origin on the ground
# at centre, front (the door) on Blender -Y = glTF +Z. One mesh, self-baked
# (bake_asset), the slates are real single-sided plates, so no HI/LO pass.
#
#   PREVIEW=1   build + shots only (no bake/export), for iterating on the look
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/carve/scripts/assets/deepglass/dg_lib.py").read())
    OUT_DIR = "/Users/troy/Documents/woc/carve/tmp/asset_src/deepglass"
    PREVIEW = bool(globals().get('PREVIEW', 0))
    import random
    rnd = random.Random(11)
    reset_scene()
    studio_lights()

    # ---- palette: the warden tower's own materials -------------------------
    mats = [
        mat_stone("dgh_stone", STONE, STONE_DARK, scale=2.0, bump=0.30),                       # 0
        mat_stone("dgh_stone_dark", STONE_DARK, srgb(0x4a463f), scale=3.0, bump=0.38),         # 1
        mat_brass("dgh_brass", scale=4.0, patina=0.28),                                        # 2
        mat_rune("dgh_rune", RUNE_CYAN, 1.2),                                                  # 3
        mat_rune("dgh_warm", RUNE_WARM, 0.8),                                                  # 4
        mat_stone("dgh_wood", srgb(0x9a4a2c), srgb(0x5c2a16), scale=2.0, rough=(0.55, 0.85), bump=0.30),  # 5 door leaf
        mat_stone("dgh_slate_a", srgb(0x22345e), srgb(0x141f3a), scale=3.0, rough=(0.50, 0.80), bump=0.18),  # 6
        mat_stone("dgh_slate_b", srgb(0x2a3d6a), srgb(0x17233f), scale=3.0, rough=(0.50, 0.80), bump=0.18),  # 7
        mat_stone("dgh_slate_c", srgb(0x1d2d54), srgb(0x111a30), scale=3.0, rough=(0.50, 0.80), bump=0.18),  # 8
        mat_stone("dgh_plank", srgb(0x8c6a42), srgb(0x55391f), scale=1.6, rough=(0.55, 0.85), bump=0.30),    # 9
        mat_stone("dgh_timber", srgb(0x5a3d22), srgb(0x33200f), scale=1.6, rough=(0.55, 0.85), bump=0.30),   # 10
        mat_stone("dgh_iron", srgb(0x3a3d42), srgb(0x22252a), scale=3.0, rough=(0.35, 0.6), bump=0.12),      # 11
        mat_stone("dgh_glass", srgb(0x161c26), srgb(0x0c1017), scale=4.0, rough=(0.25, 0.4), bump=0.05),     # 12 unlit panes
    ]
    M_STONE, M_DARK, M_BRASS, M_RUNE, M_WARM, M_WOOD = 0, 1, 2, 3, 4, 5
    M_SLATE = (6, 7, 8)
    M_PLANK, M_TIMBER, M_IRON, M_GLASS = 9, 10, 11, 12
    LIT_FRACTION = 0.3   # only a few windows glow; the rest are dark glass
    def window_lit():
        return rnd.random() < LIT_FRACTION
    def slate():
        return M_SLATE[rnd.randrange(3)]

    Z = lambda x, y, z: Vector((x, y, z))
    UP = Vector((0, 0, 1))

    # ---- generic helpers ------------------------------------------------------
    def frame_rot(n, t):
        """Rotation whose local x = n (outward), y = t (along), z = up."""
        return Matrix((n, t, UP)).transposed()

    def beam(bm, p0, p1, thick, mat, thick2=None):
        """A square (or thick x thick2) timber along the segment p0->p1."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        rot = d.normalized().to_track_quat('X', 'Z').to_matrix()
        box(bm, (L, thick, thick2 or thick), center=tuple((p0 + p1) * 0.5), mat=mat, rot=rot)

    def wall_box(bm, cx, cy, z0, z1, hx, hy, mat):
        box(bm, (hx * 2, hy * 2, z1 - z0), center=(cx, cy, (z0 + z1) * 0.5), mat=mat)

    def poly(bm, pts, mat, flip=False):
        vs = [bm.verts.new(Vector(p)) for p in pts]
        if flip:
            vs.reverse()
        f = bm.faces.new(vs)
        f.material_index = mat
        f.smooth = False
        return f

    def shingle(bm, top_c, U, V, N, w, h, mat, off=0.0):
        """One scalloped slate: a plate hanging DOWN from its top edge centre
        `top_c` (width w along U, h along -V) with a rounded bottom, lifted
        `off` along the surface normal N so upper rows overlap lower ones."""
        C = Vector(top_c) + N * off
        r = w * 0.5
        straight = max(0.02, h - r)
        pts = [C - U * r, C + U * r, C + U * r - V * straight]
        for i in range(1, 6):
            th = -math.pi * i / 6
            pts.append(C - V * straight + U * (r * math.cos(th)) + V * (r * math.sin(th)))
        pts.append(C - U * r - V * straight)
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        f.material_index = mat
        f.smooth = False
        # face the normal outward
        if f.normal.dot(N) < 0:
            bmesh.ops.reverse_faces(bm, faces=[f])
        return f

    def shingle_plane(bm, P0, U, V, N, width_at, length, row_h=0.42, tile_w=0.44, base_off=0.03):
        """Rows of slates over a planar (or near-planar) surface: P0 = bottom
        centre of the plane, U across, V up the slope, N outward. width_at(s)
        gives the plane's width at slope distance s. Rows overlap by half."""
        s = 0.0
        i = 0
        while s < length - 0.05:
            top = min(s + row_h * 1.15, length)
            wmid = width_at((s + top) * 0.5)
            n = max(1, int(round(wmid / tile_w)))
            pitch = wmid / n
            for j in range(n):
                u = -wmid * 0.5 + pitch * (j + 0.5) + (pitch * 0.5 if i % 2 else 0.0)
                if abs(u) > wmid * 0.5 + 0.01:
                    continue
                c = Vector(P0) + U * u + V * top
                shingle(bm, c, U, V, N, pitch * 0.96, top - s, slate(), off=base_off + 0.012 * i)
            s += row_h
            i += 1

    def cone_shingles(bm, R, z0, z1, cx=0.0, cy=0.0, row_h=0.44, tile_w=0.46, base_off=0.03, r_min=0.22):
        """Rows of slates around a cone (radius R at z0, apex at z1)."""
        H = z1 - z0
        L = math.hypot(R, H)
        phi = math.atan2(H, R)
        s = 0.0
        i = 0
        while True:
            top = s + row_h * 1.15
            r_top = R * (1 - min(top, L) / L)
            r_mid = R * (1 - (s + top) * 0.5 / L)
            if r_top < r_min or s >= L - 0.05:
                break
            n = max(6, int(round(TAU * r_mid / tile_w)))
            for j in range(n):
                a = TAU * (j + (0.5 if i % 2 else 0.0)) / n
                ca, sa = math.cos(a), math.sin(a)
                U = Vector((-sa, ca, 0))
                V = Vector((-ca * math.cos(phi), -sa * math.cos(phi), math.sin(phi)))
                N = Vector((ca * math.sin(phi), sa * math.sin(phi), math.cos(phi)))
                c = Vector((cx + ca * r_top, cy + sa * r_top, z0 + top * math.sin(phi)))
                w = TAU * r_mid / n * 0.96
                shingle(bm, c, U, V, N, w, top - s, slate(), off=base_off + 0.012 * i)
            s += row_h
            i += 1

    def arch_outline(w, hs, segs=8):
        rad = w / 2
        pts = [(-rad, 0.0), (rad, 0.0), (rad, hs)]
        for i in range(1, segs):
            th = math.pi * i / segs
            pts.append((rad * math.cos(th), hs + rad * math.sin(th)))
        pts.append((-rad, hs))
        return pts

    def arch_prism(bm, n, t, base, w, hs, d0, d1, mat, segs=8):
        """Round-topped slab: base = point on the wall at the arch's foot centre,
        n outward, t along the wall; extruded from depth d0 to d1 along n."""
        outline = arch_outline(w, hs, segs)
        rings = [[bm.verts.new(Vector(base) + n * d + t * u + UP * z) for (u, z) in outline] for d in (d0, d1)]
        faces = []
        m = len(outline)
        for i in range(m):
            j = (i + 1) % m
            faces.append(bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i])))
        faces.append(bm.faces.new(rings[0]))
        faces.append(bm.faces.new(list(reversed(rings[1]))))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        for f in faces:
            f.material_index = mat
            f.smooth = False
        return faces

    def arch_frame(bm, n, t, base, w, th, hs, d0, d1, mat, segs=8):
        """Hollow round-topped surround, th thick, open at the bottom."""
        outer, inner = arch_outline(w, hs, segs), arch_outline(w - 2 * th, hs, segs)
        def ring(pts, d):
            return [bm.verts.new(Vector(base) + n * d + t * u + UP * z) for (u, z) in pts]
        O0, O1, I0, I1 = ring(outer, d0), ring(outer, d1), ring(inner, d0), ring(inner, d1)
        faces = []
        m = len(outer)
        for i in range(m):
            j = (i + 1) % m
            faces.append(bm.faces.new((O0[i], O0[j], O1[j], O1[i])))
            if i == 0:
                continue
            faces.append(bm.faces.new((O1[i], O1[j], I1[j], I1[i])))
            faces.append(bm.faces.new((I0[i], I0[j], I1[j], I1[i])))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        for f in faces:
            f.material_index = mat
            f.smooth = False
        return faces

    def arched_window(bm, n, t, base, w=0.9, hs=0.9, depth=0.14, lit=None):
        if lit is None:
            lit = window_lit()
        """An arched window standing just proud of a solid wall: warm panes on
        the wall face, a dark reveal ring, a stone surround, timber muntins,
        brass sill. (Everything sits OUTSIDE the wall box, which is solid.)"""
        arch_prism(bm, n, t, base, w, hs, 0.01, 0.03, M_WARM if lit else M_GLASS)    # panes
        arch_frame(bm, n, t, base, w + 0.02, 0.035, hs, 0.01, depth * 0.6, M_DARK)     # reveal
        arch_frame(bm, n, t, base, w + 0.24, 0.12, hs, 0.0, depth, M_STONE)            # surround
        rot = frame_rot(n, t)
        C = Vector(base)
        box(bm, (0.05, 0.05, hs + w * 0.5), center=tuple(C + n * 0.05 + UP * ((hs + w * 0.5) * 0.5)), mat=M_TIMBER, rot=rot)
        box(bm, (0.05, w, 0.05), center=tuple(C + n * 0.05 + UP * (hs * 0.55)), mat=M_TIMBER, rot=rot)
        box(bm, (depth + 0.12, w + 0.36, 0.09), center=tuple(C + n * (depth * 0.5 + 0.02) + UP * (-0.045)), mat=M_BRASS, rot=rot)

    def square_window(bm, n, t, base, w, h, cols, rows, depth=0.12, lit=None):
        if lit is None:
            lit = window_lit()
        """A rectangular multi-pane window proud of the wall: warm pane plate on
        the face, timber frame + muntins in front of it, brass sill."""
        rot = frame_rot(n, t)
        C = Vector(base)
        box(bm, (0.03, w, h), center=tuple(C + n * 0.02 + UP * (h * 0.5)), mat=M_WARM if lit else M_GLASS, rot=rot)
        for side in (-1, 1):
            box(bm, (depth, 0.09, h + 0.09), center=tuple(C + n * (depth * 0.5) + t * (side * (w * 0.5 + 0.02)) + UP * (h * 0.5)), mat=M_TIMBER, rot=rot)
        for zz in (0.0, h):
            box(bm, (depth, w + 0.13, 0.09), center=tuple(C + n * (depth * 0.5) + UP * zz), mat=M_TIMBER, rot=rot)
        for i in range(1, cols):
            u = -w * 0.5 + w * i / cols
            box(bm, (0.05, 0.04, h), center=tuple(C + n * 0.05 + t * u + UP * (h * 0.5)), mat=M_TIMBER, rot=rot)
        for j in range(1, rows):
            zz = h * j / rows
            box(bm, (0.05, w, 0.04), center=tuple(C + n * 0.05 + UP * zz), mat=M_TIMBER, rot=rot)
        box(bm, (depth + 0.1, w + 0.25, 0.07), center=tuple(C + n * (depth * 0.5 + 0.02) + UP * (-0.06)), mat=M_BRASS, rot=rot)

    def slit(bm, n, t, base, h=1.0):
        rot = frame_rot(n, t)
        C = Vector(base)
        box(bm, (0.08, 0.30, h), center=tuple(C + n * 0.005 + UP * (h * 0.5)), mat=M_DARK, rot=rot)
        box(bm, (0.10, 0.16, h - 0.16), center=tuple(C + n * 0.005 + UP * (h * 0.5)), mat=M_WARM, rot=rot)

    def strap(bm, cx, cy, hx, hy, z0, z1, rivets=True):
        """A brass strap around a rectangular storey (proud by 0.03)."""
        for (sx, sy, rx, ry) in ((1, 0, hx, hy), (-1, 0, hx, hy), (0, 1, hx, hy), (0, -1, hx, hy)):
            if sx:
                box(bm, (0.06, hy * 2 + 0.06, z1 - z0), center=(cx + sx * (hx + 0.03), cy, (z0 + z1) * 0.5), mat=M_BRASS)
            else:
                box(bm, (hx * 2 + 0.06, 0.06, z1 - z0), center=(cx, cy + sy * (hy + 0.03), (z0 + z1) * 0.5), mat=M_BRASS)
        if rivets:
            zc = (z0 + z1) * 0.5
            for (x, y) in ((hx, 0), (-hx, 0), (0, hy), (0, -hy), (hx, hy * 0.5), (hx, -hy * 0.5), (-hx, hy * 0.5), (-hx, -hy * 0.5),
                           (hx * 0.5, hy), (-hx * 0.5, hy), (hx * 0.5, -hy), (-hx * 0.5, -hy)):
                box(bm, (0.11, 0.11, 0.11), center=(cx + x * (1 + 0.075 / max(hx, 0.01)) if x else cx, cy + y * (1 + 0.075 / max(hy, 0.01)) if y else cy, zc), mat=M_BRASS)

    def rune_run(bm, n, t, base, z0, z1, lozenge=True):
        """A cyan conduit up a wall (bulging tube + a lozenge sigil)."""
        pts, radii = [], []
        M = 7
        for i in range(M):
            u = i / (M - 1)
            pts.append(Vector(base) + n * 0.02 + UP * (z0 + (z1 - z0) * u))
            radii.append(0.040 + 0.024 * math.sin(u * math.pi))
        tube_along(bm, pts, 0.04, segs=6, mat=M_RUNE, radii=radii)
        if lozenge:
            rot = frame_rot(n, t) @ Matrix.Rotation(math.radians(45), 3, 'X')
            box(bm, (0.07, 0.30, 0.30), center=tuple(Vector(base) + n * 0.035 + UP * ((z0 + z1) * 0.5)), mat=M_RUNE, rot=rot)

    def brackets(bm, hx_in, hy_in, z_top, reach, drop, mat=M_TIMBER, per_side=3, corners=True):
        """Raking timber struts under a jetty: from the wall (hx_in, hy_in) at
        z_top - drop out to the overhang edge (reach beyond) at z_top."""
        def strut(p_wall, p_edge):
            beam(bm, p_wall, p_edge, 0.17, mat)
        for sx in (-1, 1):
            for i in range(per_side):
                y = -hy_in + (hy_in * 2) * (i + 0.5) / per_side
                strut((sx * hx_in, y, z_top - drop), (sx * (hx_in + reach - 0.1), y, z_top - 0.02))
        for sy in (-1, 1):
            for i in range(per_side):
                x = -hx_in + (hx_in * 2) * (i + 0.5) / per_side
                strut((x, sy * hy_in, z_top - drop), (x, sy * (hy_in + reach - 0.1), z_top - 0.02))
        if corners:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    strut((sx * hx_in, sy * hy_in, z_top - drop * 1.15), (sx * (hx_in + reach - 0.12), sy * (hy_in + reach - 0.12), z_top - 0.02))

    def gable_roof(bm, n, t, u_c, d_front, d_back, half_w, z_eave, z_ridge, overhang=0.35, barge=True, shingles=True):
        """A steep gable whose ridge runs along n (outward) from d_back to
        d_front (+overhang), centred at u_c along t: two slate planes, front
        bargeboards + finial, rafter tails, ridge beam. Everything past d_back
        may bury itself in whatever stands behind."""
        df, db = d_front + overhang, d_back
        hw = half_w + overhang * 0.6
        P = lambda d, u, z: n * d + t * u + UP * z
        for side in (-1, 1):
            e0 = P(df, u_c + side * hw, z_eave); e1 = P(db, u_c + side * hw, z_eave)
            r0 = P(df, u_c, z_ridge); r1 = P(db, u_c, z_ridge)
            poly(bm, [e0, e1, r1, r0], M_SLATE[0])
            if shingles:
                V = (r0 - e0).normalized(); U = (e1 - e0).normalized(); N = U.cross(V)
                if N.dot(t * side) < 0:
                    N = -N
                shingle_plane(bm, (e0 + e1) * 0.5, U, V, N, lambda s, L=(e1 - e0).length: L * 0.98, (r0 - e0).length - 0.08, row_h=0.40, tile_w=0.42)
            for k in range(3):
                d = df - 0.35 - (df - db - 0.7) * k / 2
                box(bm, (0.12, 0.5, 0.14), center=tuple(P(d, u_c + side * (hw - 0.2), z_eave - 0.1)), mat=M_TIMBER, rot=frame_rot(n, t))
        if barge:
            for side in (-1, 1):
                beam(bm, tuple(P(df + 0.02, u_c + side * hw, z_eave)), tuple(P(df + 0.02, u_c, z_ridge + 0.06)), 0.11, M_TIMBER, 0.24)
            box(bm, (0.14, 0.14, 0.7), center=tuple(P(df + 0.05, u_c, z_ridge + 0.2)), mat=M_BRASS)
        box(bm, (df - db + 0.1, 0.2, 0.16), center=tuple(P((df + db) * 0.5, u_c, z_ridge + 0.04)), mat=M_TIMBER, rot=frame_rot(n, t))

    # ---- the tower ------------------------------------------------------------
    SIDES = {
        'front': (Vector((0, -1, 0)), Vector((1, 0, 0))),
        'back':  (Vector((0, 1, 0)), Vector((-1, 0, 0))),
        'left':  (Vector((-1, 0, 0)), Vector((0, -1, 0))),
        'right': (Vector((1, 0, 0)), Vector((0, 1, 0))),
    }
    def side_d(side, hx, hy):
        return hy if side in ('front', 'back') else hx

    # Variants share every material and every detail vocabulary; they differ
    # in massing: storeys, bay/gable/balcony sides, dormers, chimney, spire.
    VARIANTS = {
        'a': dict(jetties=2, ground_h=5.0, storey_h=3.9, bay='front', gables=[('front', 0.55)], balcony='right',
                  dormers=(-145, -35), chimney=(-1.7, 1.55), cone_h=5.8, drum_h=4.3, turret=None, eave=0.75),
        'b': dict(jetties=2, ground_h=5.0, storey_h=3.9, bay=None, gables=[], balcony='left',
                  dormers=(-90,), chimney=(1.7, 1.5), cone_h=7.0, drum_h=4.9, turret='fr', eave=0.65),
        'c': dict(jetties=1, ground_h=5.4, storey_h=4.2, bay='left', gables=[('front', -0.4), ('right', 0.3)], balcony=None,
                  dormers=(-125, -55, 180), chimney=(-1.7, 1.55), cone_h=4.8, drum_h=3.6, turret=None, eave=0.95),
        'd': dict(jetties=2, ground_h=6.0, storey_h=4.0, bay=None, gables=[], balcony='front',
                  dormers=(-150, -30, 90), chimney=(-1.7, 1.55), cone_h=7.4, drum_h=5.6, turret='bl', eave=0.6),
        'e': dict(jetties=2, ground_h=5.0, storey_h=3.9, bay='right', gables=[('left', 0.0), ('back', 0.4)], balcony=None,
                  dormers=(-90,), chimney=(1.7, 1.5), cone_h=5.8, drum_h=4.3, turret='fl', eave=0.75),
    }
    VARIANT = str(globals().get('VARIANT', 'a'))
    V = VARIANTS[VARIANT]
    COLL = []   # model-yard collision boxes (x, z, y0, y1, hx, hz) in Blender frame; converted on export

    def build(bm):
        HX0, HY0 = 2.5, 2.3
        Z1 = V['ground_h']
        levels = [(HX0, HY0, 0.0, Z1)]
        hx, hy, z = HX0, HY0, Z1
        for i in range(V['jetties']):
            hx += 0.35 if i == 0 else 0.30
            hy += 0.35 if i == 0 else 0.30
            levels.append((hx, hy, z, z + V['storey_h']))
            z += V['storey_h']
        HXT, HYT, ZT0, ZT1 = levels[-1]          # the top square storey
        R_DRUM = 3.0
        ZD0, ZD1 = ZT1, ZT1 + V['drum_h']
        R_EAVE = R_DRUM + V['eave']
        ZC0, ZC1 = ZD1, ZD1 + V['cone_h']
        occupied = {lvl: set() for lvl in range(len(levels))}   # sides holding a feature per storey

        # ---- socle + ground storey
        wall_box(bm, 0, 0, 0.0, 0.5, HX0 + 0.35, HY0 + 0.35, M_DARK)
        wall_box(bm, 0, 0, 0.5, 1.0, HX0 + 0.18, HY0 + 0.18, M_DARK)
        strap(bm, 0, 0, HX0 + 0.18, HY0 + 0.18, 0.86, 0.98, rivets=False)
        wall_box(bm, 0, 0, 1.0, Z1, HX0, HY0, M_STONE)
        COLL.append((0, 0, 0.0, Z1, HX0, HY0))
        n, t = SIDES['front']
        base = Vector((0, -HY0, 0.24))
        wall_box(bm, 0, -HY0 - 0.25, 0.0, 2.55, 0.95, 0.25, M_STONE)
        wall_box(bm, 0, -HY0 - 0.55, 0.0, 0.12, 1.05, 0.55, M_DARK)
        wall_box(bm, 0, -HY0 - 0.25, 2.55, 2.75, 1.05, 0.33, M_STONE)
        COLL.append((0, -HY0 - 0.28, 0.0, 2.75, 1.05, 0.3))
        face = base + n * 0.5
        arch_prism(bm, n, t, face, 1.08, 1.25, 0.01, 0.05, M_WOOD)
        arch_frame(bm, n, t, face, 1.12, 0.035, 1.25, 0.01, 0.14, M_DARK)
        arch_frame(bm, n, t, face, 1.46, 0.18, 1.25, 0.0, 0.22, M_STONE)
        for du in (-0.18, 0.18):
            box(bm, (0.02, 0.025, 1.3), center=tuple(face + n * 0.06 + t * du + UP * 0.9), mat=M_DARK, rot=frame_rot(n, t))
        for zz in (0.62, 1.22):
            box(bm, (0.04, 0.98, 0.09), center=tuple(face + n * 0.07 + UP * zz), mat=M_BRASS, rot=frame_rot(n, t))
            for du in (-0.36, 0.0, 0.36):
                box(bm, (0.05, 0.09, 0.09), center=tuple(face + n * 0.08 + t * du + UP * zz), mat=M_BRASS, rot=frame_rot(n, t))
        ring_pts = [face + n * 0.08 + t * (0.26 + 0.075 * math.cos(TAU * i / 12)) + UP * (0.95 + 0.075 * math.sin(TAU * i / 12)) for i in range(13)]
        tube_along(bm, ring_pts, 0.016, segs=6, mat=M_BRASS)
        box(bm, (0.16, 0.16, 0.24), center=tuple(face + n * 0.24 + UP * (1.25 + 0.73 + 0.1)), mat=M_BRASS, rot=frame_rot(n, t))
        box(bm, (0.10, 0.26, 0.10), center=tuple(face + n * 0.03 + UP * 2.42), mat=M_WARM, rot=frame_rot(n, t))
        for du in (-1.35, 1.35):
            box(bm, (0.16, 0.16, 0.24), center=(du, -HY0 - 0.1, 2.1), mat=M_IRON)
            box(bm, (0.12, 0.12, 0.16), center=(du, -HY0 - 0.1, 2.1), mat=M_WARM)
            box(bm, (0.05, 0.3, 0.05), center=(du, -HY0 - 0.12, 2.28), mat=M_IRON)
        slit(bm, *SIDES['left'], Vector((-HX0, -0.8, 2.6)))
        slit(bm, *SIDES['right'], Vector((HX0, 0.8, 2.6)))
        arched_window(bm, *SIDES['back'], Vector((0.4, HY0, 2.4)), w=0.8, hs=0.8)
        rune_run(bm, n, t, Vector((-1.7, -HY0, 0)), 1.4, Z1 - 0.4)
        rune_run(bm, *SIDES['right'], Vector((HX0, -1.2, 0)), 1.4, Z1 - 0.4)
        strap(bm, 0, 0, HX0, HY0, Z1 - 0.28, Z1 - 0.14)

        # ---- jettied storeys
        for lvl in range(1, len(levels)):
            hx, hy, z0, z1 = levels[lvl]
            phx, phy = levels[lvl - 1][0], levels[lvl - 1][1]
            brackets(bm, phx, phy, z0, hx - phx, 1.1 if lvl == 1 else 1.0)
            wall_box(bm, 0, 0, z0 - 0.02, z0 + 0.22, hx, hy, M_TIMBER)
            wall_box(bm, 0, 0, z0 + 0.22, z1, hx, hy, M_STONE)
            COLL.append((0, 0, z0, z1, hx, hy))
            strap(bm, 0, 0, hx, hy, z0 + 0.30, z0 + 0.44)
            strap(bm, 0, 0, hx, hy, z1 - 0.30, z1 - 0.16, rivets=False)

        # ---- bay window on the first jettied storey
        if V['bay']:
            hx, hy, z0, z1 = levels[1]
            n, t = SIDES[V['bay']]
            d = side_d(V['bay'], hx, hy)
            occupied[1].add(V['bay'])
            BW, BD, BZ0, BZ1 = 2.6, 0.75, z0 + 1.1, z0 + 3.1
            rot = frame_rot(n, t)
            box(bm, (BD, BW, BZ1 - BZ0 + 0.4), center=tuple(n * (d + BD * 0.5) + UP * ((BZ0 + BZ1) * 0.5 - 0.1)), mat=M_STONE, rot=rot)
            square_window(bm, n, t, n * (d + BD) + UP * (BZ0 + 0.15), 2.0, 1.55, 3, 2, lit=True)
            for side in (-1, 1):
                ns = t * side; ts = n * (-side)
                if ns.cross(ts).z < 0:
                    ts = -ts
                square_window(bm, ns, ts, n * (d + BD * 0.5) + t * (side * BW * 0.5) + UP * (BZ0 + 0.35), 0.45, 1.2, 1, 2, depth=0.08)
            h0 = n * (d + BD + 0.35) + t * (-BW * 0.5 - 0.3) + UP * (BZ1 + 0.1); h1 = n * (d + BD + 0.35) + t * (BW * 0.5 + 0.3) + UP * (BZ1 + 0.1)
            h2 = n * (d - 0.05) + t * (BW * 0.5 + 0.3) + UP * (BZ1 + 0.95); h3 = n * (d - 0.05) + t * (-BW * 0.5 - 0.3) + UP * (BZ1 + 0.95)
            poly(bm, [h0, h1, h2, h3], M_SLATE[0])
            Vh = (h3 - h0).normalized(); Uh = t; Nh = Uh.cross(Vh)
            if Nh.dot(n) < 0:
                Nh = -Nh
            shingle_plane(bm, (h0 + h1) * 0.5, Uh, Vh, Nh, lambda s: BW + 0.5, (h3 - h0).length - 0.05, row_h=0.36, tile_w=0.40)
            for k in range(4):
                u = -BW * 0.5 - 0.1 + (BW + 0.2) * k / 3
                box(bm, (0.6, 0.12, 0.12), center=tuple(n * (d + BD + 0.1) + t * u + UP * (BZ1 + 0.02)), mat=M_TIMBER, rot=rot)
            for u in (-BW * 0.5 + 0.25, 0, BW * 0.5 - 0.25):
                beam(bm, tuple(n * d + t * u + UP * (BZ0 - 1.0)), tuple(n * (d + BD - 0.1) + t * u + UP * (BZ0 - 0.32)), 0.15, M_TIMBER)
            box(bm, (0.3, 1.5, 0.22), center=tuple(n * (d + BD + 0.16) + UP * (BZ0 - 0.42)), mat=M_PLANK, rot=rot)
            COLL.append((n.x * (d + BD * 0.5), n.y * (d + BD * 0.5), BZ0 - 0.3, BZ1 + 0.1, BD * 0.5 if n.x else BW * 0.5, BW * 0.5 if n.x else BD * 0.5))

        # ---- gabled wings on the top square storey
        for (gside, u_c) in V['gables']:
            n, t = SIDES[gside]
            d = side_d(gside, HXT, HYT)
            occupied[len(levels) - 1].add(gside)
            GW, GD = 1.9, 0.9
            box(bm, (GD, GW, ZT1 - 0.25 - (ZT0 + 0.22)), center=tuple(n * (d + GD * 0.5) + t * u_c + UP * ((ZT0 + 0.22 + ZT1 - 0.25) * 0.5)), mat=M_STONE, rot=frame_rot(n, t))
            arched_window(bm, n, t, n * (d + GD) + t * u_c + UP * (ZT0 + 1.4), w=0.85, hs=0.95)
            gable_roof(bm, n, t, u_c, d + GD, d - 1.3, GW * 0.5 + 0.1, ZT1 - 0.25, ZT1 + 1.55)

        # ---- balcony + hoist on the top square storey
        if V['balcony']:
            n, t = SIDES[V['balcony']]
            d = side_d(V['balcony'], HXT, HYT)
            occupied[len(levels) - 1].add(V['balcony'])
            BZ = ZT0 + 1.1
            rot = frame_rot(n, t)
            P = lambda dd, u, z: n * dd + t * u + UP * z
            box(bm, (1.3, 1.7, 0.14), center=tuple(P(d + 0.65, 0, BZ)), mat=M_PLANK, rot=rot)
            for u in (-0.8, 0.8):
                beam(bm, tuple(P(d, u, BZ - 0.9)), tuple(P(d + 1.15, u, BZ - 0.1)), 0.15, M_TIMBER)
            for (dd, u) in ((1.22, -0.8), (1.22, 0.8), (1.22, 0), (0.6, -0.8), (0.6, 0.8)):
                box(bm, (0.08, 0.08, 0.95), center=tuple(P(d + dd, u, BZ + 0.5)), mat=M_TIMBER, rot=rot)
            box(bm, (0.06, 1.7, 0.06), center=tuple(P(d + 1.22, 0, BZ + 0.95)), mat=M_TIMBER, rot=rot)
            box(bm, (0.06, 1.7, 0.04), center=tuple(P(d + 1.22, 0, BZ + 0.5)), mat=M_TIMBER, rot=rot)
            for u in (-0.8, 0.8):
                box(bm, (0.66, 0.06, 0.06), center=tuple(P(d + 0.9, u, BZ + 0.95)), mat=M_TIMBER, rot=rot)
                box(bm, (0.66, 0.06, 0.04), center=tuple(P(d + 0.9, u, BZ + 0.5)), mat=M_TIMBER, rot=rot)
            arched_window(bm, n, t, P(d, 0, BZ + 0.1), w=0.8, hs=1.0, depth=0.16)
            beam(bm, tuple(P(d - 0.1, 0, ZT1 - 0.6)), tuple(P(d + 1.4, 0, ZT1 - 0.6)), 0.16, M_TIMBER)
            beam(bm, tuple(P(d, 0, ZT1 - 1.5)), tuple(P(d + 1.25, 0, ZT1 - 0.66)), 0.12, M_TIMBER)
            rope = [P(d + 1.35, 0, ZT1 - 0.65 - 0.06 * k) for k in range(1, 4)]
            rope += [P(d + 1.35 + 0.12 * math.sin(k * 0.9), 0.1 * math.cos(k * 0.9), ZT1 - 0.9 - 0.35 * k) for k in range(1, 8)]
            tube_along(bm, rope, 0.028, segs=5, mat=M_TIMBER)
            box(bm, (0.16, 0.16, 0.3), center=tuple(rope[-1] + UP * (-0.15)), mat=M_IRON)
            COLL.append((n.x * (d + 0.65), n.y * (d + 0.65), BZ - 0.1, BZ + 1.0, 0.7 if n.x else 0.85, 0.85 if n.x else 0.7))

        # ---- bartizan: a small round turret hung on a corner of the top storey
        if V['turret']:
            sx = 1 if V['turret'][1] == 'r' else -1
            sy = -1 if V['turret'][0] == 'f' else 1
            TX, TY = sx * (HXT - 0.2), sy * (HYT - 0.2)
            TR = 1.05
            TZ0, TZ1 = ZT0 + 1.6, ZT1 + 1.3
            lathe(bm, [(0.25, TZ0 - 1.6), (TR, TZ0), (TR, TZ1)], segs=12, mat=M_STONE, smooth=True, close_bottom=True, close_top=True, origin=(TX, TY, 0))
            lathe(bm, [(TR + 0.03, TZ0 + 0.05), (TR + 0.03, TZ0 + 0.17)], segs=12, mat=M_BRASS, smooth=True, origin=(TX, TY, 0))
            lathe(bm, [(TR + 0.03, TZ1 - 0.5), (TR + 0.03, TZ1 - 0.38)], segs=12, mat=M_BRASS, smooth=True, origin=(TX, TY, 0))
            a = math.atan2(sy, sx)
            nn = Vector((math.cos(a), math.sin(a), 0)); tt = Vector((-math.sin(a), math.cos(a), 0))
            slit(bm, nn, tt, Vector((TX, TY, TZ0 + 0.9)) + nn * TR, h=1.1)
            lathe(bm, [(TR + 0.45, TZ1), (TR + 0.45, TZ1 + 0.1), (0.04, TZ1 + 2.2)], segs=16, mat=M_SLATE[1], smooth=True, close_bottom=True, origin=(TX, TY, 0))
            cone_shingles(bm, TR + 0.45, TZ1 + 0.1, TZ1 + 2.2, cx=TX, cy=TY, row_h=0.34, tile_w=0.36, r_min=0.15)
            lathe(bm, [(0.0, 0.0), (0.16, 0.0), (0.16, 0.08), (0.05, 0.1), (0.05, 0.5), (0.0, 0.62)], segs=10, mat=M_BRASS, smooth=True, origin=(TX, TY, TZ1 + 2.05))
            COLL.append((TX, TY, TZ0 - 0.8, TZ1 + 1.2, TR, TR))

        # ---- side windows + rune runs wherever a storey side is free
        for lvl in range(1, len(levels)):
            hx, hy, z0, z1 = levels[lvl]
            for k, side in enumerate(('front', 'back', 'left', 'right')):
                if side in occupied[lvl]:
                    continue
                n, t = SIDES[side]
                d = side_d(side, hx, hy)
                if (lvl + k) % 2 == 0:
                    arched_window(bm, n, t, n * d + t * (-0.9) + UP * (z0 + 1.5), w=0.8, hs=0.9)
                    rune_run(bm, n, t, n * d + t * 1.4, z0 + 0.8, z1 - 0.5)
                else:
                    arched_window(bm, n, t, n * d + t * 0.9 + UP * (z0 + 1.5), w=0.8, hs=0.9)
                    arched_window(bm, n, t, n * d + t * (-1.3) + UP * (z0 + 1.5), w=0.8, hs=0.9)

        # ---- hipped slate skirt from the top storey's eave to the drum
        SK0, SK1 = HXT + 0.35, 2.15
        SKZ0, SKZ1 = ZT1, ZT1 + 1.5
        skirt = lathe(bm, [(SK0 * math.sqrt(2), SKZ0 - 0.02), (SK1 * math.sqrt(2), SKZ1)], segs=4, mat=M_SLATE[0],
                      smooth=False, close_bottom=True, close_top=True, origin=(0, 0, 0))
        sk_verts = set(v for f in skirt for v in f.verts)
        bmesh.ops.rotate(bm, verts=list(sk_verts), cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 4, 3, 'Z'))
        bmesh.ops.scale(bm, verts=list(sk_verts), vec=(1.0, HYT / HXT, 1.0))
        for (nx, ny) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            N = Vector((nx, ny, 0)); T = Vector((-ny, nx, 0))
            hw0 = (SK0 if nx else SK0 * HYT / HXT); hw1 = (SK1 if nx else SK1 * HYT / HXT)
            wid0 = (SK0 * HYT / HXT if nx else SK0) * 2; wid1 = (SK1 * HYT / HXT if nx else SK1) * 2
            e = N * hw0 + UP * SKZ0; r = N * hw1 + UP * SKZ1
            Vv = (r - e).normalized(); L = (r - e).length
            Nn = T.cross(Vv)
            if Nn.dot(N) < 0:
                Nn = -Nn
            shingle_plane(bm, e, T, Vv, Nn, lambda s, w0=wid0, w1=wid1, L=L: w0 + (w1 - w0) * s / L, L - 0.05, row_h=0.42, tile_w=0.44)
            for i in range(6):
                u = -wid0 * 0.5 + 0.4 + (wid0 - 0.8) * i / 5
                box(bm, (0.5, 0.12, 0.14), center=tuple(N * (hw0 - 0.2) + T * u + UP * (SKZ0 - 0.1)), mat=M_TIMBER, rot=frame_rot(N, T))
        for sx in (-1, 1):
            for sy in (-1, 1):
                beam(bm, (sx * (SK0 + 0.05), sy * (SK0 * HYT / HXT + 0.05), SKZ0 - 0.04), (sx * SK1, sy * (SK1 * HYT / HXT), SKZ1 + 0.03), 0.14, M_TIMBER)

        # ---- the drum
        lathe(bm, [(R_DRUM, ZD0 - 0.4), (R_DRUM, ZD1)], segs=24, mat=M_STONE, smooth=True, close_bottom=True, close_top=True)
        lathe(bm, [(R_DRUM + 0.03, ZD1 - 0.9), (R_DRUM + 0.03, ZD1 - 0.76)], segs=24, mat=M_BRASS, smooth=True)
        lathe(bm, [(R_DRUM + 0.03, SKZ1 + 0.25), (R_DRUM + 0.03, SKZ1 + 0.39)], segs=24, mat=M_BRASS, smooth=True)
        COLL.append((0, 0, ZD0, ZD1, R_DRUM + 0.05, R_DRUM + 0.05))
        tall = V['drum_h'] > 5.0
        for k in range(8):
            a = math.pi / 8 + k * TAU / 8
            n = Vector((math.cos(a), math.sin(a), 0)); t = Vector((-math.sin(a), math.cos(a), 0))
            if k % 2 == 0:
                arched_window(bm, n, t, n * R_DRUM + UP * (SKZ1 + 0.9), w=0.8, hs=0.9)
                if tall:
                    arched_window(bm, n, t, n * R_DRUM + UP * (SKZ1 + 3.0), w=0.7, hs=0.7)
            else:
                rune_run(bm, n, t, n * R_DRUM, SKZ1 + 0.7, ZD1 - 1.1)
        for k in range(16):
            a = k * TAU / 16
            n = Vector((math.cos(a), math.sin(a), 0))
            beam(bm, tuple(n * (R_DRUM - 0.05) + UP * (ZD1 - 1.1)), tuple(n * (R_EAVE - 0.25) + UP * (ZC0 - 0.06)), 0.15, M_TIMBER)
            box(bm, (0.55, 0.12, 0.14), center=tuple(n * (R_EAVE - 0.35) + UP * (ZC0 - 0.02)), mat=M_TIMBER, rot=Matrix.Rotation(a, 3, 'Z'))
        lathe(bm, [(R_EAVE + 0.05, ZC0 - 0.08), (R_EAVE + 0.05, ZC0 + 0.06)], segs=32, mat=M_TIMBER, smooth=True)
        torus(bm, R_EAVE + 0.06, 0.05, major=48, minor=6, mat=M_BRASS, center=(0, 0, ZC0 + 0.10))

        # ---- the cone of scalloped slates
        lathe(bm, [(R_EAVE, ZC0), (R_EAVE, ZC0 + 0.12), (0.06, ZC1)], segs=32, mat=M_SLATE[1], smooth=True, close_bottom=True)
        cone_shingles(bm, R_EAVE, ZC0 + 0.12, ZC1, row_h=0.46, tile_w=0.48)
        H_CONE = ZC1 - (ZC0 + 0.12)
        r_at = lambda z: R_EAVE * (ZC1 - z) / H_CONE
        z_at = lambda r: ZC1 - r / R_EAVE * H_CONE
        COLL.append((0, 0, ZC0, ZC0 + H_CONE * 0.4, r_at(ZC0 + H_CONE * 0.2) + 0.1, r_at(ZC0 + H_CONE * 0.2) + 0.1))
        COLL.append((0, 0, ZC0 + H_CONE * 0.4, ZC1, r_at(ZC0 + H_CONE * 0.65) + 0.1, r_at(ZC0 + H_CONE * 0.65) + 0.1))
        # dormers: a gabled window box that SITS on the cone, the box sinks
        # into the surface, the roof ridge is level and runs back until it is
        # buried, so nothing hangs in the air (v1 had the back edges 1.5 yd
        # above the slates)
        for adeg in V['dormers']:
            a = math.radians(adeg)
            n = Vector((math.cos(a), math.sin(a), 0)); t = Vector((-math.sin(a), math.cos(a), 0))
            zb = ZC0 + 1.0
            rf = r_at(zb)                       # where the box front meets the cone
            r_front, r_back = rf + 0.35, rf - 1.0
            r_bury = r_at(zb + 2.05) - 0.45     # ridge back end sits under the slates
            box(bm, ((r_front - r_back), 1.3, 2.0), center=tuple(n * ((r_front + r_back) * 0.5) + UP * (zb + 0.4)), mat=M_STONE, rot=frame_rot(n, t))
            arched_window(bm, n, t, n * r_front + UP * (zb + 0.2), w=0.6, hs=0.55, depth=0.12)
            fr = n * (r_front + 0.2); bk = n * r_bury
            for side in (-1, 1):
                e0 = fr + t * (side * 0.85) + UP * (zb + 1.35); e1 = bk + t * (side * 0.85) + UP * (zb + 1.35)
                r0 = fr + UP * (zb + 2.05); r1 = bk + UP * (zb + 2.05)
                poly(bm, [e0, e1, r1, r0], M_SLATE[2])
                Vv = (r0 - e0).normalized(); Uu = (e1 - e0).normalized(); Nn = Uu.cross(Vv)
                if Nn.dot(t * side) < 0:
                    Nn = -Nn
                shingle_plane(bm, (e0 + e1) * 0.5, Uu, Vv, Nn, lambda s, L=(e1 - e0).length: L * 0.98, (r0 - e0).length - 0.05, row_h=0.34, tile_w=0.36)
            beam(bm, tuple(fr + t * (-0.9) + UP * (zb + 1.33)), tuple(fr + UP * (zb + 2.08)), 0.1, M_TIMBER, 0.2)
            beam(bm, tuple(fr + t * (0.9) + UP * (zb + 1.33)), tuple(fr + UP * (zb + 2.08)), 0.1, M_TIMBER, 0.2)
            box(bm, ((r_front + 0.2 - r_bury), 0.16, 0.14), center=tuple(n * ((r_front + 0.2 + r_bury) * 0.5) + UP * (zb + 2.08)), mat=M_TIMBER, rot=frame_rot(n, t))
        # chimney through the cone, its base buried, cap + iron flue
        if V['chimney']:
            CHX, CHY = V['chimney']
            rc = math.hypot(CHX, CHY)
            ztop = z_at(rc) + 2.2
            zbot = ZD1 - 0.5
            box(bm, (0.9, 0.9, ztop - zbot), center=(CHX, CHY, (ztop + zbot) * 0.5), mat=M_STONE)
            box(bm, (1.1, 1.1, 0.25), center=(CHX, CHY, ztop + 0.12), mat=M_DARK)
            box(bm, (0.9, 0.9, 0.3), center=(CHX, CHY, ztop + 0.4), mat=M_DARK)
            lathe(bm, [(0.22, 0.0), (0.22, 1.6), (0.32, 1.6), (0.32, 1.75), (0.0, 1.75)], segs=12, mat=M_IRON, smooth=True,
                  origin=(CHX + 0.15, CHY - 0.1, ztop + 0.5))
            lathe(bm, [(0.42, 0.0), (0.42, 0.06), (0.0, 0.32)], segs=12, mat=M_IRON, smooth=True,
                  origin=(CHX + 0.15, CHY - 0.1, ztop + 2.2))
        # finial
        lathe(bm, [(0.0, 0.0), (0.36, 0.0), (0.36, 0.12), (0.12, 0.16), (0.12, 0.7), (0.19, 0.75), (0.19, 0.88), (0.07, 0.93), (0.07, 1.25), (0.0, 1.45)],
              segs=16, mat=M_BRASS, smooth=True, origin=(0, 0, ZC1 - 0.35))
        lathe(bm, [(0.0, 0.0), (0.12, 0.03), (0.15, 0.12), (0.12, 0.21), (0.0, 0.24)], segs=14, mat=M_RUNE, smooth=True,
              origin=(0, 0, ZC1 + 0.62))

    tag = "tower_spire" + ("" if VARIANT == 'a' else "_" + VARIANT)
    bm = bmesh.new()
    build(bm)
    # envelope + collision sidecar (model yards, glTF frame: x, y=up, z=-y)
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
    size = (max(xs) - min(xs), max(zs) - min(zs), max(ys) - min(ys))
    import json
    json.dump({'size': size, 'boxes': [dict(x=b[0], y=(b[2] + b[3]) * 0.5, z=-b[1], hx=b[4], hy=(b[3] - b[2]) * 0.5, hz=b[5]) for b in COLL]},
              open(OUT_DIR + f"/{tag}.collision.json", 'w'), indent=1)
    LOG.append(f"variant {VARIANT} size={tuple(round(s, 2) for s in size)} coll={len(COLL)}")
    ob = new_obj(tag, bm, mats)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    LOG.append(f"faces={len(ob.data.polygons)} tris={tris} verts={len(ob.data.vertices)}")
    shade_auto_smooth(ob, angle=40)

    def shots(suffix=""):
        H = size[1]
        render_preview(OUT_DIR + f"/{tag}{suffix}_front.png", (2.0, -H * 1.25, H * 0.5), (0, 0, H * 0.46), size=(800, 1300), fov=40)
        render_preview(OUT_DIR + f"/{tag}{suffix}_quarter.png", (H * 0.85, -H * 0.85, H * 0.62), (0, 0, H * 0.46), size=(800, 1300), fov=40)
        render_preview(OUT_DIR + f"/{tag}{suffix}_top.png", (10.0, -12.0, H + 1.0), (0, 0, H * 0.72), size=(900, 900), fov=40)
        render_preview(OUT_DIR + f"/{tag}{suffix}_back.png", (-H * 0.7, H * 0.85, H * 0.58), (0, 0, H * 0.46), size=(800, 1300), fov=40)

    if PREVIEW:
        shots("_pre")
        LOG.append("preview only")
    else:
        # SPLIT_STONE=False: the stonework stays in the atlas bake (the tiled
        # stonewash read as mottled plaster in game, reverted 2026-09-06).
        SPLIT_STONE = False
        ob_stone = None
        if SPLIT_STONE:
            # The stonework leaves the atlas bake: split off, skinned with the
            # TILED stonewash (colour + normal) at full 2K density, planar UVs in
            # object space. One atlas over a 24 yd tower gave every block a few
            # texels; the tile gives ~500 px per yard.
            STONE_TILE_K = 0.14   # one repeat per ~7 yd
            stone_mat = bpy.data.materials.new("WocStoneTiledSpire")
            stone_mat.use_nodes = True
            snt = stone_mat.node_tree
            sb = snt.nodes['Principled BSDF']
            simg = bpy.data.images.load(OUT_DIR.replace('/tmp/asset_src/deepglass', '/scripts/assets/deepglass') + "/WardenStoneTile_Color.jpg"); simg.pack()
            stex = snt.nodes.new('ShaderNodeTexImage'); stex.image = simg
            snt.links.new(stex.outputs['Color'], sb.inputs['Base Color'])
            nimg = bpy.data.images.load(OUT_DIR.replace('/tmp/asset_src/deepglass', '/scripts/assets/deepglass') + "/WardenStoneTile_Normal.jpg"); nimg.colorspace_settings.name = 'Non-Color'; nimg.pack()
            ntex = snt.nodes.new('ShaderNodeTexImage'); ntex.image = nimg
            nmap = snt.nodes.new('ShaderNodeNormalMap'); nmap.inputs['Strength'].default_value = 0.8
            snt.links.new(ntex.outputs['Color'], nmap.inputs['Color']); snt.links.new(nmap.outputs['Normal'], sb.inputs['Normal'])
            sb.inputs['Roughness'].default_value = 0.85
            bm2 = bmesh.new(); bm2.from_mesh(ob.data)
            stone_faces = [f for f in bm2.faces if f.material_index == M_STONE]
            nb = bmesh.new(); vmap = {}
            for f in stone_faces:
                vs = []
                for v in f.verts:
                    if v.index not in vmap:
                        vmap[v.index] = nb.verts.new(v.co)
                    vs.append(vmap[v.index])
                try:
                    nf = nb.faces.new(vs); nf.smooth = f.smooth
                except ValueError:
                    pass
            nb.normal_update()
            sme = bpy.data.meshes.new(tag + "_stone"); nb.to_mesh(sme); nb.free()
            bmesh.ops.delete(bm2, geom=stone_faces, context='FACES'); bm2.to_mesh(ob.data); bm2.free()
            sme.materials.append(stone_mat)
            suv = sme.uv_layers.new()
            for poly in sme.polygons:
                n = poly.normal
                for li in poly.loop_indices:
                    co = sme.vertices[sme.loops[li].vertex_index].co
                    if abs(n.z) > 0.7:
                        suv.data[li].uv = (co.x * STONE_TILE_K, co.y * STONE_TILE_K)
                    elif abs(n.y) > 0.7:
                        suv.data[li].uv = (co.x * STONE_TILE_K, co.z * STONE_TILE_K)
                    else:
                        suv.data[li].uv = (co.y * STONE_TILE_K, co.z * STONE_TILE_K)
            ob_stone = bpy.data.objects.new(tag + "_stone", sme)
            bpy.context.scene.collection.objects.link(ob_stone)
            shade_auto_smooth(ob_stone, angle=40)
        uv_project([ob], angle=60, island_margin=0.003)
        paths, imgs = bake_asset([ob], tag, size=2048, samples=20, ao_amount=0.5)
        LOG.append("baked")
        mat = baked_material(tag, imgs, emissive_strength=1.0)
        apply_baked([ob], mat)
        export_glb([ob] + ([ob_stone] if ob_stone else []), OUT_DIR + f"/{tag}.glb")
        LOG.append("exported")
        shots()
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
