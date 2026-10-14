# Warden Wharf kit - WoW-style timber docks for Tidehold's two harbour mouths,
# in the Warden wall's language: hand-painted plank decks on rope-wrapped,
# brass-collared piles and X-braced trestles, Warden masonry with a dark tide
# band, riveted brass strap courses, cyan rune glass, merlons.
#
# PIECES (env WHARF_PIECE):
#   deck / deck_rail / deck_rails - 8 x 8 straight pier module (planks across
#       the pier, which runs along glTF Z); rail = one rope rail on +X, rails
#       = both sides. Butts seamlessly on every side (planks tile per module).
#   quay / quay_rail - a boardwalk SECTOR fitted to the harbour wall: r 277..293
#       about the island centre, 0.04 rad wide, origin at r 285 on its centre
#       bearing (local +Z = radially out, +X = increasing bearing). Adjacent
#       sectors tile the arc exactly; the inner 2.5 yd lie on the quay.
#   bastion - octagonal Warden pier head (apothem ~7.3), plank top, parapet
#       with merlons on the three seaward faces (glTF +Z), rune conduits.
#   bastion_open - the same head with its straight seaward face left open
#       between the corner piers: the wharf's end, where a berth runs out.
#   stairs - top landing (butts a pier side at glTF -Z) and a flight running
#       down along -X INTO the harbour, so a swimmer walks up out of the water.
#   crane / mast / lamp / bollard - dressing that stands ON a deck.
#   quay_wide / quay_wide_rail - the boardwalk sector for docks laid out at
#       scale 1.5: built for a ring of 1/1.5 the harbour's radius (r 184.33..
#       200.33, 0.06 rad, origin 192.33), so at scale 1.5 it tiles the real
#       ring exactly (r 276.5..300.5, 3 yd on the quay) with the kit's own
#       proportions and texture density at that scale.
#   berth - the ship connector: a 4.6 x 2.5 plank gangway on three piles, rope
#       rails, both ends open - the seaward one to a galleon's boarding
#       landing. Fills bastion_open's gap (the wharf's end) or stands off a
#       pier's side.
#
# Docks laid out 50% larger (wharf_layout.py) place the pile-borne pieces at
# scaleX = scaleZ = 1.5 with height 1: the plan grows, the deck stays at 36
# over the pile feet and rails, parapets and the tide band stay at walking
# and waterline heights. Dressing (lamps, bollards, cranes, mast, shed) takes
# a uniform 1.5.
#
# Frames: Blender Z up, authored in yards, nothing below z = 0. Pile-borne
# pieces have their pile feet at z = 0 and the deck top at H = 36: place them
# detached with groundY = 6.08 - 36 so the planks sit 8 cm over the cobbles
# (world 6.0) and the waterline (world -2) lands at local WATER. Dressing pieces
# stand with their base at z = 0 (groundY = deck top).
#
# Collision sidecar (tmp/asset_src/deepglass/wharf_<piece>.collision.json):
# glTF frame, model yards: blocking `boxes` (piles, rails, parapets, plinths),
# walkable `ramps` (decks, the flight), both with an optional yaw `ry`.
#
# Headless: WHARF_PIECE=<piece> [PREVIEW=1] Blender -b --python <this>
import os
import json
import math
import random
import traceback
LOG = []
try:
    # Repo root: a prepended REPO_ROOT, else WOC_REPO, else from __file__ (absent under a text-block or bridge exec).
    REPO_ROOT = globals().get('REPO_ROOT') or os.environ.get('WOC_REPO') or os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(globals()['__file__'])), '..', '..', '..'))
    exec(open(os.path.join(REPO_ROOT, "scripts/assets/deepglass/dg_lib.py")).read())
    ROOT = REPO_ROOT
    OUT_DIR = ROOT + "/tmp/asset_src/deepglass"
    TEX = ROOT + "/scripts/assets/deepglass/wharf_tex"
    os.makedirs(OUT_DIR, exist_ok=True)
    PIECE = str(globals().get("PIECE", os.environ.get("WHARF_PIECE", "deck")))
    PREVIEW = bool(globals().get("PREVIEW", os.environ.get("PREVIEW", "") == "1"))
    reset_scene()
    studio_lights()
    rnd = random.Random(1307)

    # ---- kit constants (yards) ---------------------------------------------
    H = 36.0              # deck top above the pile feet
    WATER = 27.92         # world -2 in a pile-borne piece's frame (groundY -29.92)
    T_DECK = 0.28
    J_W, J_D = 0.34, 0.6  # joists
    HD = 0.55             # header (pile cap) square
    PILE_R = 0.42
    K_PLANK = 8.0 / 3.0   # three plank repeats per 8 yd module: butted modules tile
    K_TIMBER = 1.6
    K_STONE = 5.0
    K_BRASS = 1.5
    Q_RM, Q_RI, Q_RO, Q_D = 285.0, 277.0, 293.0, 0.04

    # ---- materials ----------------------------------------------------------
    def load_img(fn, noncolor=False):
        im = bpy.data.images.load(TEX + "/" + fn, check_existing=True)
        if noncolor:
            im.colorspace_settings.name = 'Non-Color'
        return im

    def tex_mat(name, color_fn, normal_fn=None, rough=0.8, metal=0.0, nstr=0.8):
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

    M_PLANK, M_TIMBER, M_STONE, M_STONE_DK, M_BRASS, M_IRON, M_ROPE, M_RUNE, M_CLOTH, M_BOARDS, M_SHINGLE = range(11)
    K_BOARDS = 1.8
    K_SHINGLE = 2.3
    MATS = [
        tex_mat("wharf_planks", "WharfPlanks_Color.jpg", "WharfPlanks_Normal.jpg", rough=0.86),
        tex_mat("wharf_timber", "WharfTimber_Color.jpg", "WharfTimber_Normal.jpg", rough=0.84),
        tex_mat("wharf_stone", "WharfStone_Color.jpg", "WharfStone_Normal.jpg", rough=0.9),
        tex_mat("wharf_stone_dark", "WharfStoneDark_Color.jpg", "WharfStone_Normal.jpg", rough=0.95),
        tex_mat("wharf_brass", "WharfBrass_Color.jpg", None, rough=0.38, metal=0.72),
        flat_mat("wharf_iron", srgb(0x3a3c40), rough=0.55, metal=0.5),
        flat_mat("wharf_rope", srgb(0xc9a86a), rough=0.95),
        flat_mat("wharf_rune", (RUNE_CYAN[0] * 0.3, RUNE_CYAN[1] * 0.3, RUNE_CYAN[2] * 0.3, 1.0),
                 rough=0.35, emit=RUNE_CYAN, strength=4.0),
        flat_mat("wharf_cloth", srgb(0x2a8f9c), rough=0.9),
        tex_mat("wharf_boards", "WharfBoards_Color.jpg", "WharfBoards_Normal.jpg", rough=0.86),
        tex_mat("wharf_shingle", "WharfShingle_Color.jpg", "WharfShingle_Normal.jpg", rough=0.72, nstr=1.0),
    ]

    # ---- mesh building with UVs -----------------------------------------------
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    COLL = []    # (cx, cy, z0, z1, hx, hy, ry)   Blender frame
    RAMPS = []   # (cx, cy, hx, hy, y0, y1, ry)   rises along local +X

    def col(cx, cy, z0, z1, hx, hy, ry=0.0):
        COLL.append((cx, cy, z0, z1, hx, hy, ry))

    def ramp(cx, cy, hx, hy, y0, y1=None, ry=0.0):
        RAMPS.append((cx, cy, hx, hy, y0, y0 if y1 is None else y1, ry))

    def planar_uv(face, au, av, K, ou=0.0, ov=0.0):
        for loop in face.loops:
            co = loop.vert.co
            loop[uvl].uv = (co.dot(au) / K + ou, co.dot(av) / K + ov)

    def wbox(size, center, mat, K=K_TIMBER, rot=None, grain='long', tex='v'):
        """Box with per-face planar UVs in its own axes. `grain` is the local
        axis the texture grain follows ('long' = the longest); `tex` says which
        image axis carries the grain: 'v' (timber boards) or 'u' (planks)."""
        faces = box(bm, size, center=center, mat=mat, rot=rot)
        M = rot if rot is not None else Matrix.Identity(3)
        axes = [M.col[0].copy(), M.col[1].copy(), M.col[2].copy()]
        g = max(range(3), key=lambda i: size[i]) if grain == 'long' else grain
        for f in faces:
            f.normal_update()
            ni = max(range(3), key=lambda i: abs(f.normal.dot(axes[i])))
            inplane = [i for i in range(3) if i != ni]
            if g in inplane:
                other = inplane[0] if inplane[1] == g else inplane[1]
                ag, ao = axes[g], axes[other]
            else:
                ag, ao = axes[inplane[0]], axes[inplane[1]]
            if tex == 'v':
                planar_uv(f, ao, ag, K)
            else:
                planar_uv(f, ag, ao, K)
        return faces

    def frame_for(d):
        d = Vector(d).normalized()
        up = Vector((0, 0, 1))
        if abs(d.dot(up)) > 0.95:
            up = Vector((0, 1, 0))
        side = up.cross(d).normalized()
        up2 = d.cross(side).normalized()
        return Matrix((d, side, up2)).transposed()

    def beam(p0, p1, w, h, mat=M_TIMBER, K=K_TIMBER, tex='v', ext=0.0):
        p0 = Vector(p0)
        p1 = Vector(p1)
        d = p1 - p0
        return wbox((d.length + 2 * ext, w, h), (p0 + p1) * 0.5, mat, K=K, rot=frame_for(d), grain=0, tex=tex)

    def cyl(cx, cy, r, z0, z1, mat, K=K_TIMBER, segs=10, top=True, bottom=False, phase=0.0):
        circ = TAU * r
        r0, r1 = [], []
        for i in range(segs + 1):
            a = phase + TAU * i / segs
            x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
            r0.append(bm.verts.new((x, y, z0)))
            r1.append(bm.verts.new((x, y, z1)))
        for i in range(segs):
            f = bm.faces.new([r0[i], r0[i + 1], r1[i + 1], r1[i]])
            f.material_index = mat
            f.smooth = True
            u0, u1 = circ * i / segs / K, circ * (i + 1) / segs / K
            for loop, uv in zip(f.loops, [(u0, z0 / K), (u1, z0 / K), (u1, z1 / K), (u0, z1 / K)]):
                loop[uvl].uv = uv
        ring = [(cx + math.cos(phase + TAU * i / segs) * r, cy + math.sin(phase + TAU * i / segs) * r) for i in range(segs)]
        if top:
            f = bm.faces.new([bm.verts.new((x, y, z1)) for x, y in ring])
            f.material_index = mat
            planar_uv(f, Vector((1, 0, 0)), Vector((0, 1, 0)), K)
        if bottom:
            f = bm.faces.new([bm.verts.new((x, y, z0)) for x, y in reversed(ring)])
            f.material_index = mat
            planar_uv(f, Vector((1, 0, 0)), Vector((0, 1, 0)), K)

    def rod(p0, p1, r, mat, segs=8, K=K_TIMBER, caps=True):
        p0 = Vector(p0)
        p1 = Vector(p1)
        d = p1 - p0
        L = d.length
        M = frame_for(d)
        s, u = M.col[1], M.col[2]
        circ = TAU * r
        a0, a1 = [], []
        for i in range(segs + 1):
            a = TAU * i / segs
            off = s * (math.cos(a) * r) + u * (math.sin(a) * r)
            a0.append(bm.verts.new(p0 + off))
            a1.append(bm.verts.new(p1 + off))
        for i in range(segs):
            f = bm.faces.new([a0[i], a0[i + 1], a1[i + 1], a1[i]])
            f.material_index = mat
            f.smooth = True
            u0, u1 = circ * i / segs / K, circ * (i + 1) / segs / K
            for loop, uv in zip(f.loops, [(u0, 0.0), (u1, 0.0), (u1, L / K), (u0, L / K)]):
                loop[uvl].uv = uv
        if caps:
            for pp, rev in ((p0, True), (p1, False)):
                vs = [bm.verts.new(pp + s * (math.cos(TAU * i / segs) * r) + u * (math.sin(TAU * i / segs) * r)) for i in range(segs)]
                f = bm.faces.new(list(reversed(vs)) if rev else vs)
                f.material_index = mat

    def pyramid(cx, cy, z0, half, h, mat):
        b = [bm.verts.new((cx + sx * half, cy + sy * half, z0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        apex = bm.verts.new((cx, cy, z0 + h))
        for i in range(4):
            f = bm.faces.new([b[i], b[(i + 1) % 4], apex])
            f.material_index = mat
            planar_uv(f, Vector((1, 0, 0)), Vector((0.0, 0.7, 0.7)), K_BRASS)
        f = bm.faces.new(list(reversed(b)))
        f.material_index = mat

    def crystal(cx, cy, cz, r, hh, mat, n=6):
        top = bm.verts.new((cx, cy, cz + hh))
        bot = bm.verts.new((cx, cy, cz - hh))
        eq = [bm.verts.new((cx + r * math.cos(TAU * i / n), cy + r * math.sin(TAU * i / n), cz)) for i in range(n)]
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new([eq[i], eq[j], top])
            f.material_index = mat
            f = bm.faces.new([eq[j], eq[i], bot])
            f.material_index = mat

    def rope_pts(pa, pb, sag, t0=0.0, t1=1.0, n=9):
        pa = Vector(pa)
        pb = Vector(pb)
        out = []
        for j in range(n):
            t = t0 + (t1 - t0) * j / (n - 1)
            out.append(pa.lerp(pb, t) - Vector((0, 0, sag * math.sin(math.pi * t))))
        return out

    def rope(pa, pb, sag, r=0.045, t0=0.0, t1=1.0, n=9):
        tube_along(bm, rope_pts(pa, pb, sag, t0, t1, n), r, segs=6, mat=M_ROPE)

    def plank_slab(poly, ztop, thick, K, dir_angle=0.0, ou=0.0, ov=0.0, edge_mat=M_TIMBER):
        """Plank top (tiling planks, grain along dir_angle) over a timber-edged slab.
        `poly` is CCW seen from +Z."""
        d = Vector((math.cos(dir_angle), math.sin(dir_angle), 0.0))
        q = Vector((-d.y, d.x, 0.0))
        top = [bm.verts.new((x, y, ztop)) for x, y in poly]
        bot = [bm.verts.new((x, y, ztop - thick)) for x, y in poly]
        ft = bm.faces.new(top)
        ft.material_index = M_PLANK
        planar_uv(ft, d, q, K, ou, ov)
        fb = bm.faces.new(list(reversed(bot)))
        fb.material_index = edge_mat
        planar_uv(fb, d, q, K_TIMBER)
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new([bot[i], bot[j], top[j], top[i]])
            f.material_index = edge_mat
            e = (Vector(poly[j]) - Vector(poly[i]))
            e = Vector((e.x, e.y, 0.0)).normalized()
            planar_uv(f, Vector((0, 0, 1)), e, K_TIMBER)
        return ft

    def pile(x, y, top, r=PILE_R, rope_wrap=True):
        ph = rnd.uniform(0.0, TAU)
        rr = r * rnd.uniform(0.94, 1.06)
        cyl(x, y, rr, 0.0, top, M_TIMBER, segs=10, top=False, phase=ph)
        cyl(x, y, rr + 0.05, top - 0.62, top - 0.36, M_BRASS, K=K_BRASS, segs=10, top=True, bottom=True, phase=ph)
        if rope_wrap:
            # one fat hemp wrap at the waterline (two rings cost 2/3 of a pier
            # module's triangles for no read at play distance)
            torus(bm, rr + 0.09, 0.12, major=8, minor=3, mat=M_ROPE, center=(x, y, WATER + 0.3))
        col(x, y, 0.0, top, rr, rr)

    def post(x, y, z0, h, w=0.32):
        wbox((w, w, h), (x, y, z0 + h / 2), M_TIMBER, grain=2)
        wbox((w + 0.08, w + 0.08, 0.1), (x, y, z0 + h + 0.05), M_BRASS, K=K_BRASS)
        pyramid(x, y, z0 + h + 0.1, (w + 0.06) / 2, 0.17, M_BRASS)

    def lozenge(center, axis, s=0.2, t=0.03):
        """A rune lozenge (the Warden sigil) facing along +/-X or +/-Y."""
        if axis == 'y':
            rot = Matrix.Rotation(math.pi / 4, 3, 'Y')
            wbox((s, t, s), center, M_RUNE, rot=rot)
        else:
            rot = Matrix.Rotation(math.pi / 4, 3, 'X')
            wbox((t, s, s), center, M_RUNE, rot=rot)

    def lantern(x, y, ztop, s=0.52, h=0.72):
        beam((x, y, ztop + 0.14), (x, y, ztop - 0.02), 0.05, 0.05, mat=M_IRON)
        pyramid(x, y, ztop - 0.2, s / 2 + 0.07, 0.22, M_BRASS)
        wbox((s + 0.12, s + 0.12, 0.06), (x, y, ztop - 0.23), M_BRASS, K=K_BRASS)
        zc = ztop - 0.26 - h / 2
        wbox((s - 0.06, s - 0.06, h - 0.08), (x, y, zc), M_RUNE)
        for cx, cy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            wbox((0.05, 0.05, h), (x + cx * (s / 2 - 0.02), y + cy * (s / 2 - 0.02), zc), M_BRASS, K=K_BRASS)
        wbox((s + 0.1, s + 0.1, 0.08), (x, y, zc - h / 2 - 0.04), M_BRASS, K=K_BRASS)

    # ---- octagon helpers (bastion, mast plinth) ------------------------------
    def oct_pts(A, z, n=8, phase=math.pi / 8):
        R = A / math.cos(math.pi / n)
        return [Vector((R * math.cos(phase + TAU * k / n), R * math.sin(phase + TAU * k / n), z)) for k in range(n)]

    def band(A0, z0, A1, z1, mat, K=K_STONE, n=8, phase=math.pi / 8):
        p0 = oct_pts(A0, z0, n, phase)
        p1 = oct_pts(A1, z1, n, phase)
        uoff = 0.0
        for k in range(n):
            j = (k + 1) % n
            f = bm.faces.new([bm.verts.new(p0[k]), bm.verts.new(p0[j]), bm.verts.new(p1[j]), bm.verts.new(p1[k])])
            f.material_index = mat
            e = (p0[j] - p0[k])
            w = e.length
            e.normalize()
            for loop in f.loops:
                co = loop.vert.co
                loop[uvl].uv = ((uoff + (co - p0[k]).dot(e)) / K, co.z / K)
            uoff += w

    def ledge(A0, A1, z, mat, K=K_STONE, n=8, phase=math.pi / 8):
        """Horizontal ring between two octagons at one height (up-facing when A1 < A0)."""
        a = oct_pts(A0, z, n, phase)
        b = oct_pts(A1, z, n, phase)
        for k in range(n):
            j = (k + 1) % n
            vs = [a[k], a[j], b[j], b[k]] if A1 < A0 else [a[j], a[k], b[k], b[j]]
            f = bm.faces.new([bm.verts.new(v) for v in vs])
            f.material_index = mat
            planar_uv(f, Vector((1, 0, 0)), Vector((0, 1, 0)), K)

    def oct_cap(A, z, mat, K, dir_angle=0.0, n=8, phase=math.pi / 8):
        f = bm.faces.new([bm.verts.new(v) for v in oct_pts(A, z, n, phase)])
        f.material_index = mat
        d = Vector((math.cos(dir_angle), math.sin(dir_angle), 0.0))
        planar_uv(f, d, Vector((-d.y, d.x, 0.0)), K)
        return f

    # ==== PIECES =============================================================
    def build_deck(sides):
        HS = 4.0
        plank_slab([(-HS, -HS), (HS, -HS), (HS, HS), (-HS, HS)], H, T_DECK, K_PLANK,
                   dir_angle=0.0, ou=HS / K_PLANK, ov=HS / K_PLANK)
        zj1 = H - T_DECK
        zj0 = zj1 - J_D
        for x in (-2.9, -0.97, 0.97, 2.9):
            wbox((J_W, 2 * HS, J_D), (x, 0.0, (zj0 + zj1) / 2), M_TIMBER, grain=1)
        for sx in (-1, 1):
            wbox((0.16, 2 * HS, 0.72), (sx * (HS - 0.08), 0.0, H - 0.36), M_TIMBER, grain=1)
        zh1 = zj0
        zh0 = zh1 - HD
        for by in (-2.0, 2.0):
            wbox((2 * HS - 0.3, HD, HD), (0.0, by, (zh0 + zh1) / 2), M_TIMBER, grain=0)
            for px in (-3.55, 0.0, 3.55):
                pile(px, by, zh0)
        zb0, zb1 = WATER + 2.4, zh0 - 0.35
        for i, by in enumerate((-2.0, 2.0)):
            off = by + (0.5 if by > 0 else -0.5)
            lo, hi = (zb0, zb1) if i == 0 else (zb1, zb0)
            beam((-3.55, off, lo), (0.0, off, hi), 0.22, 0.2)
            beam((0.0, off, lo), (3.55, off, hi), 0.22, 0.2)
        for sx in (-1, 1):
            xo = sx * 4.02
            beam((xo, -2.0, zb0), (xo, 2.0, zb1), 0.22, 0.2)
            beam((xo + sx * 0.22, -2.0, zb1), (xo + sx * 0.22, 2.0, zb0), 0.22, 0.2)
        for side in sides:
            xr = side * 3.55
            for py in (-2.0, 2.0):
                post(xr, py, H, 1.45)
            beam((xr, -HS, H + 1.3), (xr, HS, H + 1.3), 0.2, 0.17)
            rope((xr, -2.0, H + 0.95), (xr, 2.0, H + 0.95), 0.3)
            rope((xr, 2.0, H + 0.95), (xr, 6.0, H + 0.95), 0.3, t1=0.5, n=5)
            rope((xr, -6.0, H + 0.95), (xr, -2.0, H + 0.95), 0.3, t0=0.5, n=5)
            col(xr, 0.0, H, H + 1.45, 0.24, HS)
        ramp(0.0, 0.0, HS, HS, H)

    RING = [Q_RI, Q_RO, Q_RM, Q_D]   # the ring build_quay fits (quay_wide swaps it)

    def QP(r, th, z=0.0):
        return Vector((r * math.sin(th), RING[2] - r * math.cos(th), z))

    def build_quay(rail, ring=None):
        if ring:
            RING[:] = ring
        Q_RI, Q_RO, Q_RM, Q_D = RING
        o = Q_RI - 277.0   # the kit's radii below are authored off the r 277 inner edge
        a = Q_D / 2
        poly = [QP(Q_RI, a), QP(Q_RI, -a), QP(Q_RO, -a), QP(Q_RO, a)]
        plank_slab([(p.x, p.y) for p in poly], H, T_DECK, K_PLANK, dir_angle=math.pi / 2)
        zj1 = H - T_DECK
        zj0 = zj1 - J_D
        zjm = (zj0 + zj1) / 2
        for r in (279.3, 283.5, 287.7, 291.9):
            beam(QP(r + o, -a, zjm), QP(r + o, a, zjm), J_W, J_D)
        beam(QP(Q_RO - 0.08, -a, H - 0.36), QP(Q_RO - 0.08, a, H - 0.36), 0.16, 0.72)
        zh1 = zj0
        zh0 = zh1 - HD
        zb0, zb1 = WATER + 2.4, zh0 - 0.35
        piles_r = (281.3 + o, 286.7 + o, 292.2 + o)
        for bi, th in enumerate((-a / 2, a / 2)):
            beam(QP(279.0 + o, th, (zh0 + zh1) / 2), QP(Q_RO - 0.3, th, (zh0 + zh1) / 2), HD, HD)
            for r in piles_r:
                p = QP(r, th)
                pile(p.x, p.y, zh0)
            t_hat = Vector((math.cos(th), math.sin(th), 0.0))
            off = t_hat * (0.5 if bi == 1 else -0.5)
            for k in range(2):
                ra, rb = piles_r[k], piles_r[k + 1]
                lo, hi = (zb0, zb1) if (k + bi) % 2 == 0 else (zb1, zb0)
                beam(QP(ra, th, lo) + off, QP(rb, th, hi) + off, 0.22, 0.2)
        ro = piles_r[-1] + 0.52
        beam(QP(ro, -a / 2, zb0), QP(ro, a / 2, zb1), 0.22, 0.2)
        beam(QP(ro + 0.22, -a / 2, zb1), QP(ro + 0.22, a / 2, zb0), 0.22, 0.2)
        if rail:
            rr = Q_RO - 0.45
            for th in (-a / 2, a / 2):
                p = QP(rr, th)
                post(p.x, p.y, H, 1.45)
            beam(QP(rr, -a, H + 1.3), QP(rr, a, H + 1.3), 0.2, 0.17)
            pa, pb = QP(rr, -a / 2, H + 0.95), QP(rr, a / 2, H + 0.95)
            rope(pa, pb, 0.3)
            rope(pb, QP(rr, 1.5 * a, H + 0.95), 0.3, t1=0.5, n=5)
            rope(QP(rr, -1.5 * a, H + 0.95), pa, 0.3, t0=0.5, n=5)
            c = QP(rr, 0.0)
            col(c.x, c.y, H, H + 1.45, rr * math.sin(a), 0.24)
        y_lo = Q_RM - Q_RO * math.cos(a)
        y_hi = Q_RM - Q_RI * math.cos(a)
        ramp(0.0, (y_lo + y_hi) / 2, Q_RO * math.sin(a), (y_hi - y_lo) / 2, H)

    def build_bastion(open_face=False):
        """The octagonal pier head. `open_face` leaves the straight seaward face
        (glTF +Z) without its parapet, the corner piers flanking the gap: the
        wharf's end, where a `berth` gangway runs out to a galleon."""
        prof = [
            (0.0, 7.45, 26.6, 7.02, M_STONE),
            (26.6, 7.13, 29.3, 7.09, M_STONE_DK),
            (29.3, 6.98, 34.45, 6.9, M_STONE),
            (34.45, 7.02, 34.95, 7.02, M_BRASS),
            (34.95, 7.22, 35.45, 7.22, M_STONE),
            (35.45, 7.36, 36.0, 7.36, M_STONE),
        ]
        for i, (z0, A0, z1, A1, mat) in enumerate(prof):
            band(A0, z0, A1, z1, mat, K=K_BRASS if mat == M_BRASS else K_STONE)
            if i + 1 < len(prof):
                nA = prof[i + 1][1]
                if abs(nA - A1) > 1e-4:
                    ledge(A1, nA, z1, mat if nA < A1 else prof[i + 1][4])
        # plank top inside the coping ring
        A_IN = 6.3
        oct_cap(A_IN, H, M_PLANK, K_PLANK, dir_angle=0.0)
        ledge(7.36, A_IN, H, M_STONE)
        # dentils under the cornice, three per face
        for k in range(8):
            ang = TAU * k / 8
            nrm = Vector((math.cos(ang), math.sin(ang), 0.0))
            tan = Vector((-nrm.y, nrm.x, 0.0))
            rot = Matrix.Rotation(ang, 3, 'Z')
            for t in (-1.9, 0.0, 1.9):
                c = nrm * 7.05 + tan * t
                wbox((0.36, 0.5, 0.34), (c.x, c.y, 34.95 - 0.17 + 0.0), M_STONE, K=K_STONE, rot=rot)
            if k % 2 == 1:
                # rune conduit up the diagonal faces, lozenge at the strap course
                c = nrm * 6.97
                wbox((0.06, 0.16, 4.8), (c.x, c.y, 29.6 + 2.4), M_RUNE, rot=rot)
            else:
                c = nrm * 7.05
                wbox((0.05, 0.34, 0.34), (c.x, c.y, 34.7), M_RUNE, rot=rot @ Matrix.Rotation(math.pi / 4, 3, 'X'))
        # iron mooring rings on the two flank faces, in the tide band
        for sx in (-1, 1):
            for t in (-1.6, 1.6):
                torus(bm, 0.42, 0.07, major=12, minor=4, mat=M_IRON, center=(sx * 7.2, t, 28.2), axis='X')
        # parapet + merlons on the three seaward faces (Blender -Y = glTF +Z)
        chord = 2 * 7.36 * math.tan(math.pi / 8) + 0.5
        for k in ((5, 7) if open_face else (5, 6, 7)):
            ang = TAU * k / 8
            nrm = Vector((math.cos(ang), math.sin(ang), 0.0))
            tan = Vector((-nrm.y, nrm.x, 0.0))
            rot = Matrix.Rotation(ang, 3, 'Z')
            c = nrm * 7.0
            wbox((0.72, chord, 1.0), (c.x, c.y, H + 0.5), M_STONE, K=K_STONE, rot=rot)
            wbox((0.8, chord, 0.1), (c.x, c.y, H + 1.05), M_BRASS, K=K_BRASS, rot=rot)
            for t in (-1.5, 1.5):
                m = c + tan * t
                wbox((0.72, 1.1, 0.62), (m.x, m.y, H + 1.1 + 0.31), M_STONE, K=K_STONE, rot=rot)
            col(c.x, c.y, H, H + 1.72, chord / 2, 0.36, ry=ang + math.pi / 2)
        # corner piers where the parapet turns (they close the mitre gaps, and
        # end the run with a pier like the curtain wall's pilasters)
        for k in (4.5, 5.5, 6.5, 7.5):
            ang = TAU * k / 8
            c = Vector((math.cos(ang), math.sin(ang), 0.0)) * (7.0 / math.cos(math.pi / 8))
            rot = Matrix.Rotation(ang, 3, 'Z')
            wbox((1.05, 1.05, 1.62), (c.x, c.y, H + 0.81), M_STONE, K=K_STONE, rot=rot)
            wbox((1.15, 1.15, 0.12), (c.x, c.y, H + 1.68), M_BRASS, K=K_BRASS, rot=rot)
            pyramid(c.x, c.y, H + 1.74, 0.5, 0.34, M_STONE)
            col(c.x, c.y, H, H + 1.74, 0.56, 0.56, ry=ang)
        # the octagon as four slabs, each running face to opposite face and
        # exactly one face wide: their union IS the octagon (two squares made
        # an eight-point star, floor and wall 3 yd past every face)
        for k in range(4):
            col(0.0, 0.0, 0.0, H - 0.05, 7.2, 7.2 * math.tan(math.pi / 8), ry=k * math.pi / 4)
            ramp(0.0, 0.0, 7.2, 7.2 * math.tan(math.pi / 8), H, ry=k * math.pi / 4)

    def build_stairs():
        W = 3.0
        HW = W / 2
        L = 1.6                       # half the top landing
        Z_FOOT = 26.62                # world -3.3: the flight runs into the harbour
        RUN = 14.4
        NT = 32                       # risers; NT - 1 treads, the landing the last step
        x_head, x_foot = -L, -L - RUN
        rise = H - Z_FOOT
        riser, going = rise / NT, RUN / (NT - 1)
        # top landing: planks on joists and two piles; its +Y edge butts the pier
        plank_slab([(-L, -L), (L, -L), (L, L), (-L, L)], H, T_DECK, K_PLANK, dir_angle=math.pi / 2)
        zj1 = H - T_DECK
        for x in (-1.1, 0.0, 1.1):
            wbox((J_W, 2 * L, J_D), (x, 0.0, zj1 - J_D / 2), M_TIMBER, grain=1)
        zh0 = zj1 - J_D - HD
        wbox((2 * L, HD, HD), (0.0, -1.2, zh0 + HD / 2), M_TIMBER, grain=0)
        for px in (-1.25, 1.25):
            pile(px, -1.2, zh0)
        # treads (planks run across the flight), closed risers under each nosing
        for k in range(NT - 1):
            xt = x_foot + going * (k + 0.5)
            zt = Z_FOOT + riser * (k + 1)
            wbox((going + 0.04, W, 0.12), (xt, 0.0, zt - 0.06), M_PLANK, K=K_PLANK, grain=1, tex='u')
            wbox((0.06, W - 0.04, riser - 0.1), (x_foot + going * k, 0.0, zt - 0.1 - (riser - 0.1) / 2), M_TIMBER, grain=1)
        # stringers
        for sy in (-1, 1):
            ys = sy * (HW + 0.14)
            beam((x_foot - 0.2, ys, Z_FOOT - 0.35), (x_head + 0.1, ys, H - 0.3), 0.28, 0.9)
        # supports under the flight: two bents of piles with a cap beam
        for f in (0.34, 0.72):
            x = x_head - RUN * f
            zs = Z_FOOT + (x - x_foot) / RUN * rise - 0.85
            wbox((HD, W + 0.9, HD), (x, 0.0, zs - HD / 2), M_TIMBER, grain=1)
            for sy in (-1, 1):
                pile(x, sy * (HW + 0.14), zs - HD)
        # rails along both sides of the flight + the landing's two open sides
        stations = [x_head - RUN * f for f in (0.0, 0.25, 0.5, 0.75, 0.98)]
        for sy in (-1, 1):
            ys = sy * (HW + 0.14)
            tops = []
            for x in stations:
                zt = Z_FOOT + (x - x_foot) / RUN * rise
                post(x, ys, zt - 0.1, 1.35, w=0.26)
                tops.append(Vector((x, ys, zt + 1.12)))
            beam(tops[-1] + Vector((-0.3, 0, -0.2)), tops[0] + Vector((0.2, 0, 0.13)), 0.18, 0.15)
            for i in range(len(tops) - 1):
                rope(tops[i] - Vector((0, 0, 0.42)), tops[i + 1] - Vector((0, 0, 0.42)), 0.22)
            col((x_foot + x_head) / 2, ys, Z_FOOT - 0.6, H + 1.3, RUN / 2 + 0.2, 0.2)
        for (a, b) in (((L - 0.16, -L + 0.2), (L - 0.16, L - 0.2)), ((-L + 0.2, -L + 0.16), (L - 0.2, -L + 0.16))):
            post(a[0], a[1], H, 1.45, w=0.28)
            post(b[0], b[1], H, 1.45, w=0.28)
            beam((a[0], a[1], H + 1.3), (b[0], b[1], H + 1.3), 0.18, 0.15)
            rope((a[0], a[1], H + 0.95), (b[0], b[1], H + 0.95), 0.22)
        col(L - 0.16, 0.0, H, H + 1.45, 0.2, L)
        col(0.0, -L + 0.16, H, H + 1.45, L, 0.2)
        # the walkable flight runs through the tread NOSINGS: feet ride the step
        # edges and never sink into a tread
        ramp((x_foot + x_head) / 2, 0.0, RUN / 2, HW, Z_FOOT + riser, H)
        ramp(0.0, 0.0, L, L, H)

    def build_lamp():
        wbox((0.95, 0.95, 0.4), (0.0, 0.0, 0.2), M_STONE, K=K_STONE)
        wbox((1.0, 1.0, 0.09), (0.0, 0.0, 0.27), M_BRASS, K=K_BRASS)
        wbox((0.34, 0.34, 4.6), (0.0, 0.0, 0.4 + 2.3), M_TIMBER, grain=2)
        for z in (0.58, 3.2, 4.78):
            wbox((0.42, 0.42, 0.13), (0.0, 0.0, z), M_BRASS, K=K_BRASS)
        for s in (-1, 1):
            lozenge((0.0, s * 0.185, 2.35), 'y', s=0.22)
        beam((-0.1, 0.0, 4.55), (1.3, 0.0, 4.55), 0.2, 0.2)
        beam((0.12, 0.0, 3.75), (0.95, 0.0, 4.47), 0.09, 0.09, mat=M_IRON)
        pyramid(0.0, 0.0, 5.0, 0.2, 0.3, M_BRASS)
        lantern(1.12, 0.0, 4.44)
        col(0.0, 0.0, 0.0, 5.0, 0.48, 0.48)

    def build_bollard():
        wbox((1.7, 0.74, 0.08), (0.0, 0.0, 0.04), M_IRON)
        for x in (-0.45, 0.45):
            cyl(x, 0.0, 0.27, 0.08, 0.98, M_TIMBER, segs=10, top=False)
            cyl(x, 0.0, 0.31, 0.92, 1.04, M_BRASS, K=K_BRASS, segs=10, top=True, bottom=True)
            cyl(x, 0.0, 0.3, 0.3, 0.4, M_IRON, segs=10, top=True, bottom=True)
            torus(bm, 0.35, 0.06, major=10, minor=4, mat=M_ROPE, center=(x, 0.0, 0.64))
        rope((-0.45, 0.33, 0.64), (0.45, 0.33, 0.64), 0.04, r=0.06, n=4)
        rope((-0.45, -0.33, 0.64), (0.45, -0.33, 0.64), 0.04, r=0.06, n=4)
        for R, z in ((0.44, 0.07), (0.35, 0.17), (0.26, 0.27)):
            torus(bm, R, 0.066, major=10, minor=3, mat=M_ROPE, center=(1.42, 0.12, z))
        col(0.25, 0.0, 0.0, 1.04, 1.15, 0.42)

    def build_crane():
        wbox((3.0, 3.0, 1.1), (0.0, 0.0, 0.55), M_STONE, K=K_STONE)
        wbox((3.1, 3.1, 0.18), (0.0, 0.0, 0.84), M_BRASS, K=K_BRASS)
        for s in (-1, 1):
            lozenge((s * 1.52, 0.0, 0.55), 'x', s=0.34)
            lozenge((0.0, s * 1.52, 0.55), 'y', s=0.34)
        cyl(0.0, 0.0, 1.15, 1.12, 1.32, M_IRON, segs=16, top=True)
        wbox((0.64, 0.64, 7.9), (0.0, 0.0, 1.32 + 3.95), M_TIMBER, grain=2)
        for z in (2.2, 5.3, 8.55):
            wbox((0.74, 0.74, 0.16), (0.0, 0.0, z), M_BRASS, K=K_BRASS)
        beam((-1.9, 0.0, 8.6), (6.6, 0.0, 9.1), 0.5, 0.5)
        beam((0.3, 0.0, 5.2), (4.3, 0.0, 8.82), 0.32, 0.32)
        beam((-0.3, 0.0, 6.4), (-1.6, 0.0, 8.4), 0.26, 0.26)
        wbox((1.15, 0.98, 1.05), (-1.55, 0.0, 7.85), M_STONE, K=K_STONE)
        for z in (7.55, 8.15):
            wbox((1.19, 1.02, 0.1), (-1.55, 0.0, z), M_BRASS, K=K_BRASS)
        rod((6.45, -0.16, 8.72), (6.45, 0.16, 8.72), 0.38, M_BRASS, segs=12, K=K_BRASS)
        beam((6.45, -0.28, 9.1), (6.45, -0.28, 8.6), 0.08, 0.08, mat=M_IRON)
        beam((6.45, 0.28, 9.1), (6.45, 0.28, 8.6), 0.08, 0.08, mat=M_IRON)
        rod((6.83, 0.0, 8.72), (6.83, 0.0, 4.25), 0.05, M_ROPE, segs=6)
        rod((6.83, 0.0, 4.25), (6.83, 0.0, 3.95), 0.09, M_IRON, segs=6)
        # the load: two strapped crates and a cask under the hook
        for (cx, cy, cz, s) in ((6.83, 0.0, 3.35, 1.0), (6.73, 0.12, 2.43, 0.86)):
            wbox((s, s, s * 0.9), (cx, cy, cz), M_PLANK, K=1.4, grain=0, tex='u')
            for d in (-0.25, 0.25):
                wbox((s + 0.04, 0.08, s * 0.9 + 0.04), (cx, cy + d * s, cz), M_ROPE)
        for sy in (-1, 1):
            rope((6.83, sy * 0.52, 3.9), (6.83, 0.0, 4.25), 0.02, r=0.04, n=3)
        # winch on the landward side of the plinth
        for sy in (-1, 1):
            wbox((0.5, 0.12, 0.9), (-1.9, sy * 0.62, 1.55), M_IRON)
        rod((-1.9, -0.6, 1.62), (-1.9, 0.6, 1.62), 0.3, M_TIMBER, segs=10)
        for t in (-0.3, 0.0, 0.3):
            rod((-1.9, t - 0.1, 1.62), (-1.9, t + 0.1, 1.62), 0.34, M_ROPE, segs=10)
        beam((-1.9, 0.72, 1.62), (-1.9, 0.9, 1.62), 0.08, 0.08, mat=M_IRON)
        beam((-1.9, 0.9, 1.62), (-2.3, 0.9, 1.95), 0.07, 0.07, mat=M_IRON)
        rod((-1.9, 0.0, 1.95), (-0.25, 0.0, 8.5), 0.045, M_ROPE, segs=5, caps=False)
        col(0.0, 0.0, 0.0, 1.32, 1.5, 1.5)
        col(0.0, 0.0, 1.32, 9.2, 0.36, 0.36)
        col(-1.9, 0.0, 1.0, 2.1, 0.3, 0.75)

    def build_mast():
        band(1.38, 0.0, 1.3, 1.05, M_STONE, K=K_STONE)
        ledge(1.3, 1.4, 1.05, M_BRASS, K=K_BRASS)
        band(1.4, 1.05, 1.4, 1.3, M_BRASS, K=K_BRASS)
        ledge(1.4, 0.0, 1.3, M_STONE)
        for k in range(8):
            ang = TAU * k / 8
            nrm = Vector((math.cos(ang), math.sin(ang), 0.0))
            rot = Matrix.Rotation(ang, 3, 'Z')
            if k % 2 == 1:
                c = nrm * 1.33
                wbox((0.05, 0.12, 0.7), (c.x, c.y, 0.55), M_RUNE, rot=rot)
        cyl(0.0, 0.0, 0.42, 1.3, 21.0, M_TIMBER, segs=10, top=True)
        for z in (1.5, 4.5, 7.5, 10.5, 13.5, 16.2, 20.6):
            cyl(0.0, 0.0, 0.48, z - 0.12, z + 0.12, M_BRASS, K=K_BRASS, segs=10, top=True, bottom=True)
        z = 2.2
        while z < 16.4:
            wbox((0.46, 0.09, 0.09), (0.62, 0.0, z), M_TIMBER)
            z += 0.55
        # crow's nest
        NR, NZ = 1.75, 17.0
        n = 10
        pts = [(NR * math.cos(TAU * i / n), NR * math.sin(TAU * i / n)) for i in range(n)]
        plank_slab(pts, NZ + 0.22, 0.22, K_PLANK)
        for i in range(n):
            j = (i + 1) % n
            beam((pts[i][0] * 1.02, pts[i][1] * 1.02, NZ + 0.05), (pts[j][0] * 1.02, pts[j][1] * 1.02, NZ + 0.05), 0.14, 0.24)
        for i in range(0, n, 2):
            x, y = pts[i][0] * 0.94, pts[i][1] * 0.94
            wbox((0.14, 0.14, 1.05), (x, y, NZ + 0.22 + 0.52), M_TIMBER, grain=2)
        for i in range(0, n, 2):
            j = (i + 2) % n
            beam((pts[i][0] * 0.94, pts[i][1] * 0.94, NZ + 1.2), (pts[j][0] * 0.94, pts[j][1] * 0.94, NZ + 1.2), 0.12, 0.12)
        for k in range(4):
            ang = TAU * k / 4 + math.pi / 4
            beam((0.4 * math.cos(ang), 0.4 * math.sin(ang), 15.2), (1.3 * math.cos(ang), 1.3 * math.sin(ang), NZ), 0.14, 0.14)
        # the beacon: rune crystal in a brass cage
        cyl(0.0, 0.0, 0.62, 21.0, 21.16, M_BRASS, K=K_BRASS, segs=10, top=True, bottom=True)
        for k in range(4):
            ang = TAU * k / 4 + math.pi / 4
            wbox((0.07, 0.07, 1.74), (0.5 * math.cos(ang), 0.5 * math.sin(ang), 22.03), M_BRASS, K=K_BRASS)
        crystal(0.0, 0.0, 22.05, 0.34, 0.72, M_RUNE)
        pyramid(0.0, 0.0, 22.9, 0.6, 0.42, M_BRASS)
        beam((0.0, 0.0, 23.3), (0.0, 0.0, 24.1), 0.06, 0.06, mat=M_BRASS, K=K_BRASS)
        # pennant: a waving swallowtail strip, two skins a hair apart. Its UVs
        # run 0 at the hoist to 1 at the fly (across 0..1), which is the weight
        # the renderer's wind shader flaps it by (render/ship_wind.ts).
        segs = 6
        for side, dy in ((1, 0.012), (-1, -0.012)):
            top, bot = [], []
            for i in range(segs + 1):
                t = i / segs
                x = 0.46 + 2.9 * t
                w = 0.55 * (1.0 - 0.55 * t)
                y = dy + 0.18 * math.sin(t * 2.6 * math.pi) * t
                zc = 19.65 - 0.25 * t
                top.append(bm.verts.new((x, y, zc + w)))
                bot.append(bm.verts.new((x, y, zc - w)))
            for i in range(segs):
                q = [bot[i], bot[i + 1], top[i + 1], top[i]]
                uv = [(i / segs, 0.0), ((i + 1) / segs, 0.0), ((i + 1) / segs, 1.0), (i / segs, 1.0)]
                if side <= 0:
                    q, uv = list(reversed(q)), list(reversed(uv))
                f = bm.faces.new(q)
                f.material_index = M_CLOTH
                for loop, t2 in zip(f.loops, uv):
                    loop[uvl].uv = t2
        # stays
        for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
            rod((0.0, 0.0, 20.0), (sx * 1.15, sy * 1.15, 1.32), 0.035, M_ROPE, segs=5, caps=False)
        for k in range(4):   # the octagonal plinth (see build_bastion)
            col(0.0, 0.0, 0.0, 1.3, 1.35, 1.35 * math.tan(math.pi / 8), ry=k * math.pi / 4)
        col(0.0, 0.0, 1.3, NZ, 0.5, 0.5)

    def quad_prism(top, thick, mat_top, mat_side, K_top, u_dir):
        """A slab under the quad `top` (4 points, CCW seen from outside/above):
        textured top, edge-material bottom and sides, `thick` along -normal."""
        top = [Vector(p) for p in top]
        n = (top[1] - top[0]).cross(top[3] - top[0]).normalized()
        bot = [p - n * thick for p in top]
        u = Vector(u_dir).normalized()
        v = n.cross(u).normalized()
        f = bm.faces.new([bm.verts.new(p) for p in top])
        f.material_index = mat_top
        planar_uv(f, u, v, K_top)
        f = bm.faces.new([bm.verts.new(p) for p in reversed(bot)])
        f.material_index = mat_side
        planar_uv(f, u, v, K_TIMBER)
        for i in range(4):
            j = (i + 1) % 4
            f = bm.faces.new([bm.verts.new(bot[i]), bm.verts.new(bot[j]), bm.verts.new(top[j]), bm.verts.new(top[i])])
            f.material_index = mat_side
            e = (top[j] - top[i]).normalized()
            planar_uv(f, e, n, K_TIMBER)

    def build_shed():
        """The harbourmaster's shed: weathered teal boards in a dark timber
        frame on a sill, blue slate gable roof (the Tidehold roofs), plank door
        with brass strap hinges, shuttered window, rune lantern and a sign
        board. Stands ON a deck (origin at its sill); the door faces glTF +Z."""
        W, D, WH, RISE = 5.2, 4.0, 3.1, 1.9
        hx, hy = W / 2, D / 2
        z0 = 0.25
        ze = z0 + WH
        zr = ze + RISE
        wbox((W + 0.34, D + 0.34, z0), (0.0, 0.0, z0 / 2), M_TIMBER, grain=0)
        for sy in (-1, 1):
            wbox((W - 0.3, 0.16, WH), (0.0, sy * (hy - 0.08), z0 + WH / 2), M_BOARDS, K=K_BOARDS, grain=2)
        for sx in (-1, 1):
            wbox((0.16, D - 0.3, WH), (sx * (hx - 0.08), 0.0, z0 + WH / 2), M_BOARDS, K=K_BOARDS, grain=2)
            # gable: a board triangle up to the ridge
            tri = [Vector((sx * (hx - 0.08), -hy + 0.1, ze)), Vector((sx * (hx - 0.08), hy - 0.1, ze)), Vector((sx * (hx - 0.08), 0.0, zr))]
            if sx < 0:
                tri = [tri[1], tri[0], tri[2]]
            f = bm.faces.new([bm.verts.new(p) for p in tri])
            f.material_index = M_BOARDS
            planar_uv(f, Vector((0, 1, 0)), Vector((0, 0, 1)), K_BOARDS)
        for sx in (-1, 1):
            for sy in (-1, 1):
                wbox((0.34, 0.34, WH + 0.12), (sx * (hx - 0.06), sy * (hy - 0.06), z0 + (WH + 0.12) / 2), M_TIMBER, grain=2)
        for sy in (-1, 1):
            wbox((W + 0.1, 0.3, 0.26), (0.0, sy * (hy - 0.06), ze), M_TIMBER, grain=0)
            wbox((W - 0.3, 0.2, 0.16), (0.0, sy * (hy - 0.03), z0 + 1.1), M_TIMBER, grain=0)
        for sx in (-1, 1):
            wbox((0.3, D + 0.1, 0.26), (sx * (hx - 0.06), 0.0, ze), M_TIMBER, grain=1)
        # roof: two slate slabs, eaves overhanging 0.55, gables 0.45
        ox, oy = hx + 0.45, hy + 0.55
        ez = ze - 0.22
        for sy in (-1, 1):
            if sy < 0:
                q = [(-ox, -oy, ez), (ox, -oy, ez), (ox, 0.0, zr + 0.12), (-ox, 0.0, zr + 0.12)]
            else:
                q = [(ox, oy, ez), (-ox, oy, ez), (-ox, 0.0, zr + 0.12), (ox, 0.0, zr + 0.12)]
            quad_prism(q, 0.16, M_SHINGLE, M_TIMBER, K_SHINGLE, (1, 0, 0))
            # bargeboards along both gable edges
            for sx in (-1, 1):
                beam((sx * (ox + 0.02), sy * oy, ez - 0.05), (sx * (ox + 0.02), 0.0, zr + 0.06), 0.12, 0.3)
        beam((-ox - 0.1, 0.0, zr + 0.18), (ox + 0.1, 0.0, zr + 0.18), 0.26, 0.24)
        # door (front = Blender -Y = glTF +Z): plank leaf, brass strap hinges, iron ring
        yf = -hy - 0.02
        wbox((1.2, 0.1, 2.2), (-1.0, yf, z0 + 1.1), M_PLANK, K=1.2, grain=2, tex='u')
        wbox((1.44, 0.14, 0.16), (-1.0, yf, z0 + 2.28), M_TIMBER, grain=0)
        for zz in (z0 + 0.45, z0 + 1.75):
            wbox((0.9, 0.12, 0.1), (-1.25, yf - 0.02, zz), M_BRASS, K=K_BRASS)
        torus(bm, 0.1, 0.022, major=8, minor=3, mat=M_IRON, center=(-0.55, yf - 0.1, z0 + 1.05), axis='Y')
        # shuttered window
        wbox((1.0, 0.08, 0.85), (1.2, yf + 0.02, z0 + 1.75), M_IRON)
        wbox((1.2, 0.2, 0.1), (1.2, yf - 0.04, z0 + 1.28), M_TIMBER, grain=0)
        for sx in (-1, 1):
            wbox((0.52, 0.08, 0.9), (1.2 + sx * 0.82, yf - 0.06, z0 + 1.75), M_BOARDS, K=K_BOARDS, grain=2)
        # sign board over the door: brass-bound, a rune lozenge for an emblem
        wbox((1.7, 0.1, 0.52), (-1.0, yf - 0.08, ze - 0.36), M_TIMBER, grain=0)
        wbox((1.8, 0.06, 0.62), (-1.0, yf - 0.03, ze - 0.36), M_BRASS, K=K_BRASS)
        lozenge((-1.0, yf - 0.15, ze - 0.36), 'y', s=0.26)
        # rune lantern by the door
        beam((-1.95, yf, 2.75), (-1.95, yf - 0.55, 2.75), 0.08, 0.08, mat=M_IRON)
        lantern(-1.95, yf - 0.55, 2.72, s=0.34, h=0.5)
        col(0.0, 0.0, 0.0, zr, hx + 0.12, hy + 0.12)

    def build_berth():
        """The ship connector (pier edge at x = 0, the gangway out along +X):
        planks on joists and two piles, rope rails on both sides, BOTH ends
        open - the seaward one where a galleon's boarding landing meets it.
        Sized to fill the open seaward face of `bastion_open` between its
        corner piers (the wharf's end), and fits a pier's side the same way."""
        D, HWB = 2.5, 2.3
        # planks start flush at the pier edge (no coplanar overlap with the deck
        # or the bastion coping); the walkable deck reaches back over that edge
        # and a hand past the open end, so no crack at either joint drops a body
        plank_slab([(0.0, -HWB), (D, -HWB), (D, HWB), (0.0, HWB)], H, T_DECK, K_PLANK,
                   dir_angle=math.pi / 2)
        zj1 = H - T_DECK
        for y in (-1.65, -0.55, 0.55, 1.65):
            wbox((D, J_W, J_D), (D / 2, y, zj1 - J_D / 2), M_TIMBER, grain=0)
        zh0 = zj1 - J_D - HD
        wbox((HD, 2 * HWB, HD), (D - 0.35, 0.0, zh0 + HD / 2), M_TIMBER, grain=1)
        wbox((0.2, 2 * HWB + 0.1, 0.5), (D - 0.05, 0.0, H - 0.3), M_TIMBER, grain=1)   # fascia
        for py in (-1.9, 0.0, 1.9):
            pile(D - 0.35, py, zh0)
        zb0, zb1 = WATER + 2.4, zh0 - 0.35
        beam((D - 0.1, -1.9, zb0), (D - 0.1, 0.0, zb1), 0.22, 0.2)
        beam((D - 0.1, 0.0, zb1), (D - 0.1, 1.9, zb0), 0.22, 0.2)
        # No gateway. A Warden arch (two brass-capped posts, a banded crossbeam
        # and the rune lozenge) used to stand across the pier edge here. SPACEY:
        # "on the dock remove this gold arch" - it framed the one doorway a
        # player walks through between the dock and the ship, and read as a
        # gold-topped gate dropped onto a working quay. The gangway now runs
        # open from the pier edge to the galleon.
        # rope rails on both sides, the full run from pier edge to open end: the
        # inboard post stands where the arch post did, so the top rail and rope
        # still die into timber instead of ending in mid-air.
        for py in (-HWB + 0.12, HWB - 0.12):
            post(0.25, py, H, 1.25, w=0.26)
            post(D - 0.18, py, H, 1.25, w=0.26)
            beam((0.25, py, H + 1.1), (D - 0.18, py, H + 1.1), 0.18, 0.15)
            rope((0.25, py, H + 0.75), (D - 0.18, py, H + 0.75), 0.12)
            col((0.25 + D - 0.18) / 2, py, H, H + 1.25, (D - 0.43) / 2 + 0.1, 0.16)
        # rope fenders on the seaward face
        for py in (-1.2, 0.0, 1.2):
            torus(bm, 0.28, 0.1, major=10, minor=5, mat=M_ROPE, center=(D + 0.05, py, H - 0.9), axis='X')
            rope((D - 0.05, py, H - 0.1), (D + 0.05, py, H - 0.62), 0.02, r=0.05, n=3)
        ramp((D - 0.1) / 2, 0.0, (D + 0.5) / 2, HWB - 0.05, H)

    def build_mine_support():
        """A mine's timber set (origin at the foot, spanning X): two squared
        posts, a cap beam with knee braces, brass strap courses at the joints
        and a hanging-hook under the cap. Built 8 wide x 6 tall; a placement's
        scaleX/scaleY size it to its bore (mine_layout.py). Only the two posts
        collide: the walkway between them stays open."""
        W, H = 8.0, 6.0
        for sx in (-1, 1):
            wbox((0.5, 0.5, H - 0.5), (sx * (W / 2 - 0.25), 0.0, (H - 0.5) / 2), M_TIMBER, grain=2)
            wbox((0.7, 0.7, 0.18), (sx * (W / 2 - 0.25), 0.0, 0.09), M_STONE, K=K_STONE)
            for z in (0.6, H - 1.1):
                wbox((0.58, 0.58, 0.12), (sx * (W / 2 - 0.25), 0.0, z), M_BRASS, K=K_BRASS)
            col(sx * (W / 2 - 0.25), 0.0, 0.0, H - 0.5, 0.26, 0.26)   # the posts are solid; the walkway is open
            # knee braces from post to cap
            beam((sx * (W / 2 - 0.4), 0.0, H - 1.9), (sx * (W / 2 - 1.6), 0.0, H - 0.55), 0.22, 0.22)
        wbox((W, 0.6, 0.55), (0.0, 0.0, H - 0.275), M_TIMBER, grain=0)
        wbox((W + 0.3, 0.7, 0.1), (0.0, 0.0, H + 0.02), M_BRASS, K=K_BRASS)
        # lagging boards over the cap, the roof a real set carries
        for i in range(-3, 4):
            wbox((0.9, 1.2, 0.12), (i * 1.1, 0.0, H + 0.13), M_TIMBER, grain=1)
        beam((0.0, 0.0, H - 0.55), (0.0, 0.0, H - 1.05), 0.08, 0.08, mat=M_IRON)   # the hook
        torus(bm, 0.16, 0.03, major=10, minor=5, mat=M_IRON, center=(0.0, 0.0, H - 1.15), axis='Y')

    def build_rail():
        """A free-standing 8 yd rope rail along X that stands ON a deck (origin at
        its foot): the pier rail's posts, top rail and rope, with half spans at the
        ends so butted rails and pier rails read as one run."""
        for py in (-2.0, 2.0):
            post(py, 0.0, 0.0, 1.45)
        beam((-4.0, 0.0, 1.3), (4.0, 0.0, 1.3), 0.2, 0.17)
        rope((-2.0, 0.0, 0.95), (2.0, 0.0, 0.95), 0.3)
        rope((2.0, 0.0, 0.95), (6.0, 0.0, 0.95), 0.3, t1=0.5, n=5)
        rope((-6.0, 0.0, 0.95), (-2.0, 0.0, 0.95), 0.3, t0=0.5, n=5)
        col(0.0, 0.0, 0.0, 1.45, 4.0, 0.24)

    BUILD = {
        'shed': build_shed,
        'rail': build_rail,
        'mine_support': build_mine_support,
        'deck': lambda: build_deck(()),
        'deck_rail': lambda: build_deck((1,)),
        'deck_rails': lambda: build_deck((1, -1)),
        'quay': lambda: build_quay(False),
        'quay_rail': lambda: build_quay(True),
        'quay_wide': lambda: build_quay(False, (184.333, 200.333, 192.333, 0.06)),
        'quay_wide_rail': lambda: build_quay(True, (184.333, 200.333, 192.333, 0.06)),
        'berth': build_berth,
        'bastion': build_bastion,
        'bastion_open': lambda: build_bastion(True),
        'stairs': build_stairs,
        'lamp': build_lamp,
        'bollard': build_bollard,
        'crane': build_crane,
        'mast': build_mast,
    }
    PILE_BORNE = {'deck', 'deck_rail', 'deck_rails', 'quay', 'quay_rail', 'quay_wide', 'quay_wide_rail',
                  'berth', 'bastion', 'bastion_open', 'stairs'}
    if PIECE not in BUILD:
        raise ValueError("unknown WHARF_PIECE " + PIECE)
    BUILD[PIECE]()
    tag = "wharf_" + PIECE

    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    size = (max(xs) - min(xs), max(zs) - min(zs), max(ys) - min(ys))
    r4 = lambda v: round(v, 4)
    side = {
        'size': [r4(s) for s in size],
        'minY': r4(min(zs)),
        'boxes': [dict(x=r4(b[0]), y=r4((b[2] + b[3]) * 0.5), z=r4(-b[1]), hx=r4(b[4]),
                       hy=r4((b[3] - b[2]) * 0.5), hz=r4(b[5]), **({'ry': r4(b[6])} if b[6] else {}))
                  for b in COLL],
        'ramps': [dict(x=r4(d[0]), z=r4(-d[1]), hx=r4(d[2]), hz=r4(d[3]), y0=r4(d[4]), y1=r4(d[5]),
                       **({'ry': r4(d[6])} if d[6] else {}))
                  for d in RAMPS],
    }
    ob = new_obj(tag, bm, MATS)
    used = sorted({p.material_index for p in ob.data.polygons})
    keep = [ob.data.materials[i] for i in used]
    remap = {old: i for i, old in enumerate(used)}
    idx = [remap[p.material_index] for p in ob.data.polygons]
    ob.data.materials.clear()
    for m in keep:
        ob.data.materials.append(m)
    for p, i in zip(ob.data.polygons, idx):
        p.material_index = i
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    LOG.append(f"piece {PIECE} size={tuple(round(s, 2) for s in size)} minZ={round(min(zs), 3)} "
               f"tris={tris} mats={[m.name for m in keep]} boxes={len(COLL)} ramps={len(RAMPS)}")

    if not PREVIEW:
        json.dump(side, open(OUT_DIR + f"/{tag}.collision.json", 'w'), indent=1)
        export_glb([ob], OUT_DIR + f"/{tag}.glb")
        LOG.append("exported " + OUT_DIR + f"/{tag}.glb")

    # ---- preview: water plane + a 1.8 yd player proxy, Cycles camera shots ----
    def cam_shot(path, cam_pos, target, res=(1100, 800), fov=40.0, samples=20):
        sc = bpy.context.scene
        cd = bpy.data.cameras.new("_cam")
        cd.angle = math.radians(fov)
        cd.clip_end = 3000.0
        cam = bpy.data.objects.new("_cam", cd)
        sc.collection.objects.link(cam)
        cam.location = Vector(cam_pos)
        cam.rotation_euler = (Vector(target) - Vector(cam_pos)).to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = 'PNG'
        sc.render.filepath = path
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)
        return path

    sun_d = bpy.data.lights.new("_sun", 'SUN')
    sun_d.energy = 3.2
    sun_d.angle = math.radians(4.0)
    sun = bpy.data.objects.new("_sun", sun_d)
    sun.rotation_euler = (math.radians(48), math.radians(12), math.radians(-35))
    bpy.context.scene.collection.objects.link(sun)
    if PIECE in PILE_BORNE:
        wm = bpy.data.materials.new("_water")
        wnt, wb = _nodes(wm)
        wb.inputs['Base Color'].default_value = (0.02, 0.16, 0.2, 1)
        wb.inputs['Roughness'].default_value = 0.08
        wb.inputs['Alpha'].default_value = 0.72
        wme = bpy.data.meshes.new("_water")
        wbm = bmesh.new()
        for v in ((-60, -60, WATER), (60, -60, WATER), (60, 60, WATER), (-60, 60, WATER)):
            wbm.verts.new(v)
        wbm.faces.new(wbm.verts)
        wbm.to_mesh(wme)
        wbm.free()
        wob = bpy.data.objects.new("_water", wme)
        wob.data.materials.append(wm)
        bpy.context.scene.collection.objects.link(wob)
    pm = bpy.data.materials.new("_proxy")
    pnt, pb = _nodes(pm)
    pb.inputs['Base Color'].default_value = (0.8, 0.1, 0.1, 1)
    pbm = bmesh.new()
    zbase = H if PIECE in PILE_BORNE else 0.0
    pxy = {'stairs': (0.0, 0.0), 'crane': (2.2, -1.6), 'mast': (2.2, 0.0), 'lamp': (1.0, -1.0), 'bollard': (0.0, -1.2)}.get(PIECE, (1.5, 0.5))
    bmesh.ops.create_cone(pbm, cap_ends=True, segments=10, radius1=0.4, radius2=0.4, depth=1.8,
                          matrix=Matrix.Translation((pxy[0], pxy[1], zbase + 0.9)))
    pme = bpy.data.meshes.new("_proxy")
    pbm.to_mesh(pme)
    pbm.free()
    pob = bpy.data.objects.new("_proxy", pme)
    pob.data.materials.append(pm)
    bpy.context.scene.collection.objects.link(pob)
    suffix = "_pre" if PREVIEW else ""
    cx = (max(xs) + min(xs)) / 2
    cy = (max(ys) + min(ys)) / 2
    if PIECE in PILE_BORNE:
        span = max(max(xs) - min(xs), max(ys) - min(ys))
        tgt = (cx, cy, H - 3.5)
        d = span * 1.25 + 8
        cam_shot(OUT_DIR + f"/{tag}{suffix}_quarter.png", (cx - d * 0.75, cy - d * 0.85, H + d * 0.45), tgt)
        cam_shot(OUT_DIR + f"/{tag}{suffix}_low.png", (cx + d * 0.9, cy - d * 0.55, WATER + 1.2), (cx, cy, H - 4.0))
    else:
        zc = (max(zs) + min(zs)) / 2
        d = max(size) * 1.6 + 2.0
        cam_shot(OUT_DIR + f"/{tag}{suffix}_quarter.png", (cx - d * 0.7, cy - d * 0.8, zc + d * 0.35), (cx, cy, zc))
    LOG.append("shots " + OUT_DIR + f"/{tag}{suffix}_*.png")
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
