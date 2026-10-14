# The Tidehold galleon - a WoW-scale three-master for the Warden harbours,
# built for players to walk: a lofted hull (rounded bilge, tumblehome, a
# sweeping sheer that steps up into a quarterdeck and a forecastle, raked stem)
# planked below and painted Warden blue above with brass wales; a walk-in
# captain's cabin under the quarterdeck, stairs up to both castles, gangway
# ports amidships on both sides; three masts, seven square sails (the main
# course carries the Tidehold crest), two jibs and a spanker, rope-net shrouds,
# wheel, capstan, hatch, stern gallery, rune lanterns, anchors, figurehead.
#
# Frame (Blender): X along the ship (bow +X), Y the beam (port +Y), Z up;
# origin midships, keel bottom at z = 0. glTF: bow = +X, port = -Z.
# Design waterline Z_WL: place detached at groundY = water - Z_WL so the main
# deck lands at water + (D_MAIN - Z_WL) (Tidehold: world 4.7, a gangplank
# below the 6.08 piers).
#
# Runs over the BlenderMCP bridge (GUI) for the design renders:
#   python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_galleon.py
# and headless for the export (glTF export over the bridge crashes 5.1):
#   GALLEON_EXPORT=1 Blender -b --python scripts/assets/deepglass/dg_galleon.py
# PIECE=gangplank builds the matching gangplank instead.
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
    TW = ROOT + "/scripts/assets/deepglass/wharf_tex"
    TS = ROOT + "/scripts/assets/deepglass/ship_tex"
    os.makedirs(OUT_DIR, exist_ok=True)
    EXPORT = bool(globals().get("EXPORT", os.environ.get("GALLEON_EXPORT", "") == "1"))
    PIECE = str(globals().get("PIECE", os.environ.get("GALLEON_PIECE", "galleon")))
    SHOTS = globals().get("SHOTS", os.environ.get("GALLEON_SHOTS", "hero,deck,stern"))
    reset_scene()
    rnd = random.Random(29)

    # ---- materials ------------------------------------------------------------
    def load_img(path, noncolor=False):
        im = bpy.data.images.load(path, check_existing=True)
        if noncolor:
            im.colorspace_settings.name = 'Non-Color'
        return im

    def tex_mat(name, color, normal=None, rough=0.8, metal=0.0, nstr=0.8, clip=False, double=False):
        mat = bpy.data.materials.new(name)
        nt, bsdf = _nodes(mat)
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(color)
        t.location = (-600, 250)
        # A textured material is also what KEEPS a mesh's UVs through the glTF
        # export (an untextured one loses TEXCOORD_0), and the wind shader
        # (render/ship_wind.ts) reads those UVs as its flap weight and seed.
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if clip:
            # glTF MASK: alpha through a Round node (cutoff 0.5)
            rnode = nt.nodes.new('ShaderNodeMath')
            rnode.operation = 'ROUND'
            rnode.location = (-250, 60)
            nt.links.new(t.outputs['Alpha'], rnode.inputs[0])
            nt.links.new(rnode.outputs['Value'], bsdf.inputs['Alpha'])
        if normal:
            tn = nt.nodes.new('ShaderNodeTexImage')
            tn.image = load_img(normal, True)
            tn.location = (-800, -260)
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.location = (-300, -260)
            nm.inputs['Strength'].default_value = nstr
            nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        mat.use_backface_culling = not double
        return mat

    def flat_mat(name, rgb, rough=0.8, metal=0.0, emit=None, strength=0.0, double=False):
        mat = bpy.data.materials.new(name)
        nt, bsdf = _nodes(mat)
        bsdf.inputs['Base Color'].default_value = rgb
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if emit is not None:
            bsdf.inputs['Emission Color'].default_value = emit
            bsdf.inputs['Emission Strength'].default_value = strength
        mat.use_backface_culling = not double
        return mat

    (M_DECK, M_HULL, M_BAND, M_TIMBER, M_BRASS, M_IRON, M_ROPE, M_RUNE, M_WARM,
     M_SAIL, M_CREST, M_NET, M_CLOTH) = range(13)
    MATS = [
        # The deck and the timber wear the wharf's grain but a lighter grade of
        # it (ship_tex/make_ship_textures.py): the honey wood of a WoW boat, moored
        # against docks that stay their weathered dark.
        tex_mat("ship_deck", TS + "/ShipDeck_Color.jpg", TW + "/WharfPlanks_Normal.jpg", rough=0.86),
        tex_mat("ship_hull", TS + "/ShipHull_Color.jpg", TS + "/ShipHull_Normal.jpg", rough=0.84),
        tex_mat("ship_band", TS + "/ShipBand_Color.jpg", TS + "/ShipBand_Normal.jpg", rough=0.8),
        tex_mat("ship_timber", TS + "/ShipTimber_Color.jpg", TW + "/WharfTimber_Normal.jpg", rough=0.84),
        tex_mat("ship_brass", TW + "/WharfBrass_Color.jpg", None, rough=0.36, metal=0.72),
        flat_mat("ship_iron", srgb(0x34363a), rough=0.55, metal=0.5),
        flat_mat("ship_rope", srgb(0xbf9d62), rough=0.95),
        flat_mat("ship_rune", (RUNE_CYAN[0] * 0.3, RUNE_CYAN[1] * 0.3, RUNE_CYAN[2] * 0.3, 1.0),
                 rough=0.35, emit=RUNE_CYAN, strength=4.0),
        flat_mat("ship_window", (RUNE_WARM[0] * 0.35, RUNE_WARM[1] * 0.35, RUNE_WARM[2] * 0.35, 1.0),
                 rough=0.3, emit=RUNE_WARM, strength=3.0),
        tex_mat("ship_sail", TS + "/ShipSail_Color.jpg", None, rough=0.92, double=True),
        tex_mat("ship_sail_crest", TS + "/ShipSailCrest_Color.jpg", None, rough=0.92, double=True),
        tex_mat("ship_rope_net", TS + "/ShipRopeNet.png", None, rough=0.95, clip=True, double=True),
        tex_mat("ship_cloth", TS + "/ShipPennant_Color.jpg", None, rough=0.9, double=True),
    ]
    K_DECK = 8.0 / 3.0
    K_HULL = 3.2
    K_TIMBER = 1.6
    K_BRASS = 1.5

    # ---- mesh + UV helpers (mirror dg_wharf.py's) -------------------------------
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    COLL = []
    RAMPS = []
    LADDERS = []   # (x, y, z0, z1, half width, outward normal yaw)   Blender frame

    def col(cx, cy, z0, z1, hx, hy, ry=0.0):
        COLL.append((cx, cy, z0, z1, hx, hy, ry))

    def ramp(cx, cy, hx, hy, y0, y1=None, ry=0.0):
        RAMPS.append((cx, cy, hx, hy, y0, y0 if y1 is None else y1, ry))

    def planar_uv(face, au, av, K, ou=0.0, ov=0.0):
        for loop in face.loops:
            co = loop.vert.co
            loop[uvl].uv = (co.dot(au) / K + ou, co.dot(av) / K + ov)

    def wbox(size, center, mat, K=K_TIMBER, rot=None, grain='long', tex='v'):
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

    def beam(p0, p1, w, h, mat=M_TIMBER, K=K_TIMBER, tex='v'):
        p0 = Vector(p0)
        p1 = Vector(p1)
        d = p1 - p0
        return wbox((d.length, w, h), (p0 + p1) * 0.5, mat, K=K, rot=frame_for(d), grain=0, tex=tex)

    def rod(p0, p1, r0, mat, segs=8, K=K_TIMBER, caps=True, r1=None):
        """A (tapered) round spar from p0 (radius r0) to p1 (radius r1)."""
        r1 = r0 if r1 is None else r1
        p0 = Vector(p0)
        p1 = Vector(p1)
        d = p1 - p0
        L = d.length
        M = frame_for(d)
        s, u = M.col[1], M.col[2]
        a0, a1 = [], []
        for i in range(segs + 1):
            a = TAU * i / segs
            dirv = s * math.cos(a) + u * math.sin(a)
            a0.append(bm.verts.new(p0 + dirv * r0))
            a1.append(bm.verts.new(p1 + dirv * r1))
        circ = TAU * max(r0, r1)
        for i in range(segs):
            f = bm.faces.new([a0[i], a0[i + 1], a1[i + 1], a1[i]])
            f.material_index = mat
            f.smooth = True
            u0, u1 = circ * i / segs / K, circ * (i + 1) / segs / K
            for loop, uv in zip(f.loops, [(u0, 0.0), (u1, 0.0), (u1, L / K), (u0, L / K)]):
                loop[uvl].uv = uv
        if caps:
            for pp, rr, rev in ((p0, r0, True), (p1, r1, False)):
                vs = [bm.verts.new(pp + (s * math.cos(TAU * i / segs) + u * math.sin(TAU * i / segs)) * rr) for i in range(segs)]
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

    def crystal(c, r, hh, mat, n=6, axis='z'):
        c = Vector(c)
        if axis == 'z':
            top, bot = c + Vector((0, 0, hh)), c - Vector((0, 0, hh))
            ring = [c + Vector((r * math.cos(TAU * i / n), r * math.sin(TAU * i / n), 0)) for i in range(n)]
        else:   # a lozenge facing +X (the figurehead / transom crest)
            top, bot = c + Vector((0, 0, hh)), c - Vector((0, 0, hh))
            ring = [c + Vector((r * 0.35 * math.cos(TAU * i / n), r * math.sin(TAU * i / n), 0)) for i in range(n)]
        tv, bv = bm.verts.new(top), bm.verts.new(bot)
        rv = [bm.verts.new(p) for p in ring]
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new([rv[i], rv[j], tv])
            f.material_index = mat
            f = bm.faces.new([rv[j], rv[i], bv])
            f.material_index = mat

    def rope(pa, pb, sag, r=0.045, n=7):
        pa = Vector(pa)
        pb = Vector(pb)
        pts = [pa.lerp(pb, j / (n - 1)) - Vector((0, 0, sag * math.sin(math.pi * j / (n - 1)))) for j in range(n)]
        tube_along(bm, pts, r, segs=5, mat=M_ROPE)

    def poly_face(pts, mat, au, av, K, reverse=False):
        vs = [bm.verts.new(p) for p in (reversed(pts) if reverse else pts)]
        f = bm.faces.new(vs)
        f.material_index = mat
        planar_uv(f, au, av, K)
        return f

    def slab(poly, ztop, thick, top_mat, K_top, dir_angle=0.0, edge_mat=M_TIMBER):
        d = Vector((math.cos(dir_angle), math.sin(dir_angle), 0.0))
        q = Vector((-d.y, d.x, 0.0))
        top = [bm.verts.new((x, y, ztop)) for x, y in poly]
        bot = [bm.verts.new((x, y, ztop - thick)) for x, y in poly]
        f = bm.faces.new(top)
        f.material_index = top_mat
        planar_uv(f, d, q, K_top)
        f = bm.faces.new(list(reversed(bot)))
        f.material_index = edge_mat
        planar_uv(f, d, q, K_TIMBER)
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new([bot[i], bot[j], top[j], top[i]])
            f.material_index = edge_mat
            e = Vector((poly[j][0] - poly[i][0], poly[j][1] - poly[i][1], 0.0))
            if e.length > 1e-6:
                planar_uv(f, Vector((0, 0, 1)), e.normalized(), K_TIMBER)

    def lantern(x, y, ztop, s=0.5, h=0.7, glass=M_RUNE):
        pyramid(x, y, ztop - 0.2, s / 2 + 0.07, 0.24, M_BRASS)
        wbox((s + 0.12, s + 0.12, 0.06), (x, y, ztop - 0.23), M_BRASS, K=K_BRASS)
        zc = ztop - 0.26 - h / 2
        wbox((s - 0.06, s - 0.06, h - 0.08), (x, y, zc), glass)
        for cx, cy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            wbox((0.05, 0.05, h), (x + cx * (s / 2 - 0.02), y + cy * (s / 2 - 0.02), zc), M_BRASS, K=K_BRASS)
        wbox((s + 0.1, s + 0.1, 0.08), (x, y, zc - h / 2 - 0.04), M_BRASS, K=K_BRASS)

    # ==== the hull form ========================================================
    XS, XB = -17.5, 18.5
    BMAX = 5.2
    Z_KEEL = 0.45
    # The waterline and the main deck are set by the Warden piers: floated on
    # the -2 harbour the main deck, the boarding landings and the pier planks
    # all sit at world 6.08, so players walk straight on and off. The hull is
    # shallow under the water, where nobody sees it, and the castles and the
    # rig are kept low (the rig's heights were authored for a 10.5 deck: RIG).
    Z_WL = 1.72
    Z_TURN = 2.5
    D_MAIN = 9.8
    D_Q, D_F = D_MAIN + 2.9, D_MAIN + 2.3
    D_P = D_Q + 2.7
    X_QF, X_FB, X_PF = -7.5, 11.0, -13.2
    RAIL = 1.15
    BW = 0.3
    GANG = (2.2, 5.4)
    RIG_K = 0.87

    def RIG(z):
        return D_MAIN + (z - 10.5) * RIG_K

    def smooth(e0, e1, x):
        t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
        return t * t * (3 - 2 * t)

    def tpos(x):
        return (x - XS) / (XB - XS)

    def half_beam(x):
        t = tpos(x)
        if t <= 0.46:
            return BMAX * (0.66 + 0.34 * smooth(0.0, 0.34, t))
        s = (t - 0.46) / 0.54
        return BMAX * max(0.0, 1 - s ** 1.8) ** 0.74

    def keel_z(x):
        """The bottom of the planking, drawn like a shipwright's profile: a long
        flat of floor along the keel amidships, the run sweeping up aft into the
        tuck under the counter, and the entry lifting forward into the stem. The
        backbone below fills both wedges with deadwood, so the keel line stays
        flat from the sternpost to the forefoot."""
        t = tpos(x)
        k = Z_KEEL
        if t > 0.80:
            k += 4.2 * ((t - 0.80) / 0.20) ** 1.7    # the entry, into the stem
        if t < 0.26:
            k += 2.5 * ((0.26 - t) / 0.26) ** 1.9    # the run, up to the tuck
        return k

    def top_z(x):
        return ((D_MAIN + RAIL) + (D_Q - D_MAIN) * (1 - smooth(X_QF - 1.1, X_QF + 0.25, x))
                + (D_P - D_Q) * (1 - smooth(X_PF - 1.0, X_PF + 0.25, x))
                + (D_F - D_MAIN) * smooth(X_FB - 0.25, X_FB + 1.1, x)
                + 0.8 * ((x - 0.5) / 18.0) ** 2 + 1.1 * smooth(0.82, 1.0, tpos(x)))

    def breadth(x, z):
        B = half_beam(x)
        k = keel_z(x)
        if z <= Z_TURN:
            u = max(0.0, (z - k) / max(0.25, Z_TURN - k))
            return max(0.18, B * math.sin(min(1.0, u) * math.pi / 2) ** 0.72)
        return max(0.18, B * (1 - 0.1 * ((z - Z_TURN) / 10.0) ** 1.4))

    def rake(x, z):
        return 2.4 * smooth(0.84, 1.0, tpos(x)) * max(0.0, z - keel_z(x)) / 12.0

    def inner_y(x, z):
        return max(0.05, breadth(x, z) - BW)

    STATIONS = sorted(set([XS, XS + 0.9, -16.0, -15.0, X_PF - 1.0, X_PF - 0.45, X_PF + 0.25, -11.6, -9.6,
                           X_QF - 1.1, X_QF - 0.45, X_QF + 0.25,
                           -6.2, GANG[0], GANG[1], -1.2, 1.0, 3.2, 5.4, 7.6, 9.5, X_FB - 0.25, X_FB,
                           X_FB + 0.55, X_FB + 1.1, 12.6, 13.9, 15.0, 16.0, 16.8, 17.5, 18.05, 18.5]))

    def levels(x):
        k = keel_z(x)
        top = top_z(x)
        zb = top - 5.0
        low = [k + (zb - k) * s for s in (0.0, 0.07, 0.16, 0.28, 0.42, 0.58, 0.77, 1.0)]
        dm = min(max(D_MAIN, zb + 0.4), top - 0.5)
        high = [(zb + dm) / 2, dm, (dm + top) / 2, top]
        return low + high, zb, dm

    NLOW = 8
    in_gang = lambda xa, xb: xa >= GANG[0] - 1e-6 and xb <= GANG[1] + 1e-6

    def P(x, y, z):
        return Vector((x + rake(x, z), y, z))

    # outer skin, both sides
    cols = []
    for x in STATIONS:
        lv, zb, dm = levels(x)
        cols.append([(z, breadth(x, z)) for z in lv])
    girth = []
    for c in cols:
        g = [0.0]
        for k in range(1, len(c)):
            g.append(g[-1] + math.hypot(c[k][0] - c[k - 1][0], c[k][1] - c[k - 1][1]))
        girth.append(g)
    # The strakes' u runs by ARC LENGTH along the skin, not by station x. At
    # both ends the sections close toward the stem and the sternpost, so a
    # face between two stations there is wide in y and z but barely advances
    # in x - with u = x/K the planks smeared into long diagonal streaks on the
    # quarters and the bow (SPACEY's shot). One shared arc per station (the mean
    # step over the planked levels) keeps every strake's plank seams in line.
    arc = [0.0]
    for i in range(1, len(STATIONS)):
        n = min(len(cols[i]), len(cols[i - 1]), NLOW)
        steps = [
            (P(STATIONS[i], cols[i][k][1], cols[i][k][0]) - P(STATIONS[i - 1], cols[i - 1][k][1], cols[i - 1][k][0])).length
            for k in range(n)
        ]
        arc.append(arc[-1] + sum(steps) / len(steps))
    for side in (-1, 1):
        for i in range(len(STATIONS) - 1):
            xa, xb = STATIONS[i], STATIONS[i + 1]
            for k in range(len(cols[i]) - 1):
                if k >= NLOW + 1 and in_gang(xa, xb):
                    continue   # the gangway port: no bulwark above the deck here
                za0, ya0 = cols[i][k]
                za1, ya1 = cols[i][k + 1]
                zb0, yb0 = cols[i + 1][k]
                zb1, yb1 = cols[i + 1][k + 1]
                q = [P(xa, side * ya0, za0), P(xb, side * yb0, zb0), P(xb, side * yb1, zb1), P(xa, side * ya1, za1)]
                if side > 0:
                    q = [q[0], q[3], q[2], q[1]]
                f = bm.faces.new([bm.verts.new(p) for p in q])
                f.material_index = M_HULL if k < NLOW - 1 else M_BAND
                f.smooth = True
                ga0, ga1 = girth[i][k], girth[i][k + 1]
                gb0, gb1 = girth[i + 1][k], girth[i + 1][k + 1]
                ua, ub = arc[i] / K_HULL, arc[i + 1] / K_HULL
                uvs = [(ua, ga0 / K_HULL), (ub, gb0 / K_HULL), (ub, gb1 / K_HULL), (ua, ga1 / K_HULL)]
                if side > 0:
                    uvs = [uvs[0], uvs[3], uvs[2], uvs[1]]
                for loop, uv in zip(f.loops, uvs):
                    loop[uvl].uv = uv
    # the bottom strip between the two keel lines
    for i in range(len(STATIONS) - 1):
        xa, xb = STATIONS[i], STATIONS[i + 1]
        za, ya = cols[i][0]
        zb_, yb = cols[i + 1][0]
        q = [P(xa, -ya, za), P(xa, ya, za), P(xb, yb, zb_), P(xb, -yb, zb_)]
        f = bm.faces.new([bm.verts.new(p) for p in q])
        f.material_index = M_HULL
        planar_uv(f, Vector((1, 0, 0)), Vector((0, 1, 0)), K_HULL)
    # transom: planked below the band line, painted above; stern windows go on it
    c0 = cols[0]
    lowpts = [P(XS, -y, z) for z, y in c0[:NLOW]] + [P(XS, y, z) for z, y in reversed(c0[:NLOW])]
    poly_face(lowpts, M_HULL, Vector((0, 1, 0)), Vector((0, 0, 1)), K_HULL, reverse=False)
    highpts = [P(XS, -y, z) for z, y in c0[NLOW - 1:]] + [P(XS, y, z) for z, y in reversed(c0[NLOW - 1:])]
    poly_face(highpts, M_BAND, Vector((0, 1, 0)), Vector((0, 0, 1)), K_HULL, reverse=False)

    # inner skin of the bulwarks/cabin walls, and the cap rail over both skins
    def inner_region(xs_list, zfloor):
        for side in (-1, 1):
            for i in range(len(xs_list) - 1):
                xa, xb = xs_list[i], xs_list[i + 1]
                if in_gang(xa, xb):
                    continue
                za0, za1 = zfloor(xa), top_z(xa)
                zb0, zb1 = zfloor(xb), top_z(xb)
                for (s0, s1) in ((0.0, 0.5), (0.5, 1.0)):
                    pa0 = P(xa, side * inner_y(xa, za0 + (za1 - za0) * s0), za0 + (za1 - za0) * s0)
                    pa1 = P(xa, side * inner_y(xa, za0 + (za1 - za0) * s1), za0 + (za1 - za0) * s1)
                    pb0 = P(xb, side * inner_y(xb, zb0 + (zb1 - zb0) * s0), zb0 + (zb1 - zb0) * s0)
                    pb1 = P(xb, side * inner_y(xb, zb0 + (zb1 - zb0) * s1), zb0 + (zb1 - zb0) * s1)
                    q = [pa0, pb0, pb1, pa1] if side > 0 else [pa0, pa1, pb1, pb0]   # facing inboard
                    f = bm.faces.new([bm.verts.new(p) for p in q])
                    f.material_index = M_BAND
                    planar_uv(f, Vector((1, 0, 0)), Vector((0, 0, 1)), K_HULL)
                # cap rail
                oa, ob = P(xa, side * breadth(xa, za1), za1), P(xb, side * breadth(xb, zb1), zb1)
                ia, ib = P(xa, side * inner_y(xa, za1), za1), P(xb, side * inner_y(xb, zb1), zb1)
                q = [oa, ob, ib, ia] if side < 0 else [oa, ia, ib, ob]
                f = bm.faces.new([bm.verts.new(p + Vector((0, 0, 0.02))) for p in q])
                f.material_index = M_TIMBER
                planar_uv(f, Vector((1, 0, 0)), Vector((0, 1, 0)), K_TIMBER)
    aft = [x for x in STATIONS if x <= X_FB + 1e-6]
    fore = [x for x in STATIONS if x >= X_FB - 1e-6 and x <= 17.5]
    inner_region(aft, lambda x: D_MAIN)
    inner_region(fore, lambda x: D_F)
    # the inside of the transom (the cabin's back wall) and the gangway cheeks
    ztop0 = top_z(XS)
    back = [P(XS + BW, -inner_y(XS, D_MAIN), D_MAIN), P(XS + BW, -inner_y(XS, ztop0), ztop0),
            P(XS + BW, inner_y(XS, ztop0), ztop0), P(XS + BW, inner_y(XS, D_MAIN), D_MAIN)]
    poly_face(back, M_BAND, Vector((0, 1, 0)), Vector((0, 0, 1)), K_HULL, reverse=True)   # facing forward, into the cabin
    for gx in GANG:
        for side in (-1, 1):
            zt = top_z(gx)
            q = [P(gx, side * inner_y(gx, D_MAIN), D_MAIN), P(gx, side * breadth(gx, D_MAIN), D_MAIN),
                 P(gx, side * breadth(gx, zt), zt), P(gx, side * inner_y(gx, zt), zt)]
            if (gx == GANG[0]) != (side > 0):
                q.reverse()
            poly_face(q, M_TIMBER, Vector((0, 1, 0)), Vector((0, 0, 1)), K_TIMBER)

    # brass wales along the band line and the deck line (thin strips proud of the skin)
    def wale(zfun, h=0.2, out=0.07, skip_gang=False):
        for side in (-1, 1):
            for i in range(len(STATIONS) - 1):
                xa, xb = STATIONS[i], STATIONS[i + 1]
                if xb > 17.8:
                    continue
                if skip_gang and in_gang(xa, xb):
                    continue   # the cap wale would bar the gangway port a player walks through
                q = []
                for (x, dz) in ((xa, -h / 2), (xb, -h / 2), (xb, h / 2), (xa, h / 2)):
                    z = zfun(x) + dz
                    q.append(P(x, side * (breadth(x, z) + out), z))
                if side > 0:
                    q = [q[0], q[3], q[2], q[1]]
                f = bm.faces.new([bm.verts.new(p) for p in q])
                f.material_index = M_BRASS
                planar_uv(f, Vector((1, 0, 0)), Vector((0, 0, 1)), K_BRASS)
    wale(lambda x: top_z(x) - 5.0 + 0.1, h=0.3)
    wale(lambda x: top_z(x) - 2.3, h=0.16)
    wale(lambda x: top_z(x) - 0.12, h=0.2, out=0.1, skip_gang=True)

    # ==== the backbone: keel, deadwood, stem, sternpost, rudder =================
    # A hull's profile the way it really goes together, so nothing hangs in the
    # water: one strip from the sternpost to the bow whose TOP always meets the
    # planking and whose BOTTOM is the flat keel line until the stem's curve
    # takes it up at the forefoot. Amidships that strip is the keel; where the
    # run and the entry sweep up it is the deadwood filling the wedge; forward
    # of the forefoot it is the stem, the cutwater curving on up to the head.
    K_W, K_H, STEM_D = 0.54, 0.82, 0.7
    # The strip runs right back to the transom station: the deadwood has to
    # close the wedge under the tuck, or the rudder and its post stand in open
    # water behind a hole (what SPACEY saw from under the counter).
    X_SP = XS                                # the sternpost's heel, under the transom

    def spine(x0, x1, steps):
        prof = []
        for i in range(steps + 1):
            x = x0 + (x1 - x0) * i / steps
            # The bottom is the FLAT keel line all the way aft to the sternpost:
            # under the run the strip is solid deadwood from the keel up to the
            # planking. It used to follow the planking up (keel_z - STEM_D), a
            # thin band hugging the tuck with open water between it and the
            # shoe - the wedge of sky SPACEY saw under the counter, twice.
            # Forward, the stem's own curve takes the bottom up at the forefoot.
            z0 = keel_z(x) - STEM_D if tpos(x) > 0.5 else 0.0
            prof.append((x, max(0.0, z0), max(K_H, keel_z(x) + 0.06)))
        for (xa, z0a, z1a), (xb, z0b, z1b) in zip(prof[:-1], prof[1:]):
            for side in (-1, 1):
                y = side * K_W / 2
                q = [(xa, y, z0a), (xb, y, z0b), (xb, y, z1b), (xa, y, z1a)]
                poly_face(q if side < 0 else list(reversed(q)), M_TIMBER,
                          Vector((1, 0, 0)), Vector((0, 0, 1)), K_TIMBER)
            q = [(xa, -K_W / 2, z0a), (xa, K_W / 2, z0a), (xb, K_W / 2, z0b), (xb, -K_W / 2, z0b)]
            poly_face(q, M_TIMBER, Vector((1, 0, 0)), Vector((0, 1, 0)), K_TIMBER)
        # end caps, so the deadwood reads solid from astern and from ahead
        for (x, z0, z1), aft in ((prof[0], True), (prof[-1], False)):
            q = [(x, -K_W / 2, z0), (x, -K_W / 2, z1), (x, K_W / 2, z1), (x, K_W / 2, z0)]
            poly_face(q if aft else list(reversed(q)), M_TIMBER,
                      Vector((0, 1, 0)), Vector((0, 0, 1)), K_TIMBER)
    spine(X_SP, XB, 40)
    # the shoe under the flat of the keel, and the stem on up the raked bow
    # the shoe runs on aft past the heel, under the rudder, so the blade's foot
    # stands on keel rather than over water
    beam((X_SP - 0.7, 0, 0.07), (11.0, 0, 0.07), K_W + 0.14, 0.14)
    stem = [P(XB, 0, z) for z in (keel_z(XB) - 0.2, keel_z(XB) + 1.6, D_MAIN - 2.0, D_MAIN + 1.2, top_z(XB))]
    for a, b in zip(stem[:-1], stem[1:]):
        beam(a, b, 0.38, 0.5)
    # the sternpost rakes aft out of the keel's heel to the counter, and the
    # rudder hangs on it: blade from the keel line up to the tiller port,
    # iron pintle straps across the joint
    # (a near-vertical `beam` measures its width fore-and-aft and its height
    # athwartships, so these read post-siding first, thickness second)
    z_tuck = keel_z(XS) + 1.1
    # the post lies on the deadwood's aft face and the rudder's leading edge
    # buries into it, so post, deadwood and blade read as one piece
    beam((X_SP - 0.16, 0, 0.18), (XS - 0.62, 0, z_tuck), 0.8, 0.58)
    beam((XS - 0.52, 0, z_tuck - 0.3), (XS - 0.86, 0, top_z(XS) - 5.4), 0.62, 0.48)
    r_heel, r_head = Vector((XS - 0.52, 0, 0.2)), Vector((XS - 1.22, 0, z_tuck + 4.4))
    beam(r_heel, r_head, 1.8, 0.34, M_TIMBER)
    for f in (0.06, 0.4, 0.76):
        p = r_heel.lerp(r_head, f)
        wbox((1.9, 0.42, 0.16), (p.x + 0.3, 0, p.z), M_IRON)

    # ==== decks =================================================================
    def deck_poly(x0, x1, z, stations_used=None):
        xs = [x0] + [x for x in STATIONS if x0 < x < x1] + [x1]
        right = [(x + rake(x, z), -inner_y(x, z)) for x in xs]
        left = [(x + rake(x, z), inner_y(x, z)) for x in reversed(xs)]
        return right + left
    slab(deck_poly(XS + BW, X_FB, D_MAIN), D_MAIN, 0.24, M_DECK, K_DECK)
    slab(deck_poly(XS + BW, X_QF, D_Q), D_Q, 0.28, M_DECK, K_DECK)
    slab(deck_poly(X_FB, 17.6, D_F), D_F, 0.28, M_DECK, K_DECK)
    slab(deck_poly(XS + BW, X_PF, D_P), D_P, 0.28, M_DECK, K_DECK)

    # the cabin bulkhead (quarterdeck front): door + two warm windows
    def bulkhead(x, z0, z1, door=True, facing=1):
        yi = inner_y(x, z0) - 0.02
        t = 0.2
        dw, dh = 0.85, min(2.2, z1 - z0 - 0.3)
        wbox((t, yi - dw, z1 - z0), (x, (yi + dw) / 2, (z0 + z1) / 2), M_BAND, K=K_HULL, grain=2)
        wbox((t, yi - dw, z1 - z0), (x, -(yi + dw) / 2, (z0 + z1) / 2), M_BAND, K=K_HULL, grain=2)
        wbox((t, 2 * dw, z1 - z0 - dh), (x, 0, (z0 + dh + z1) / 2), M_BAND, K=K_HULL, grain=1)
        for sy in (-1, 1):
            wbox((t + 0.1, 0.22, dh), (x, sy * (dw + 0.11), z0 + dh / 2), M_TIMBER, grain=2)
        wbox((t + 0.1, 2 * dw + 0.44, 0.24), (x, 0, z0 + dh + 0.12), M_TIMBER, grain=1)
        if not door:
            wbox((0.12, 2 * dw, dh), (x + facing * 0.05, 0, z0 + dh / 2), M_DECK, K=1.2, grain=2, tex='u')
            wbox((0.16, 0.9, 0.1), (x + facing * 0.12, 0, z0 + 0.45 * dh), M_BRASS, K=K_BRASS)
        wz = z0 + min(1.55, 0.55 * (z1 - z0))
        wh = min(1.0, 0.4 * (z1 - z0))
        for sy in (-1, 1):
            wy = sy * min(2.6, yi - 0.7)
            wbox((0.08, 0.9, wh), (x + facing * 0.11, wy, wz), M_WARM)
            wbox((t + 0.14, 1.12, 0.12), (x, wy, wz + wh / 2 + 0.05), M_TIMBER, grain=1)
            wbox((t + 0.14, 1.12, 0.12), (x, wy, wz - wh / 2 - 0.05), M_TIMBER, grain=1)
            wbox((t + 0.14, 0.1, wh + 0.2), (x, wy, wz), M_TIMBER, grain=2)
            # jambs, a transom bar proud of the glass and a brass drip sill: a
            # casement with four lights instead of a bare glowing slot
            for jy in (-1, 1):
                wbox((t + 0.14, 0.1, wh + 0.2), (x, wy + jy * 0.5, wz), M_TIMBER, grain=2)
            wbox((0.07, 0.9, 0.07), (x + facing * 0.16, wy, wz), M_TIMBER, grain=1)
            wbox((0.2, 1.2, 0.08), (x + facing * 0.12, wy, wz - wh / 2 - 0.15), M_BRASS, K=K_BRASS)
        return yi, dw, t
    yq, dwq, tq = bulkhead(X_QF, D_MAIN, D_Q - 0.28, door=True, facing=1)
    yf, dwf, tf = bulkhead(X_FB, D_MAIN, D_F - 0.28, door=False, facing=-1)
    # the bulkheads' boxes stop a yard under the deck above: a body at the
    # head of a flight (feet within a step of that deck) passes over them
    col(X_QF, (yq + dwq) / 2, D_MAIN, D_Q - 1.0, tq / 2 + 0.05, (yq - dwq) / 2)
    col(X_QF, -(yq + dwq) / 2, D_MAIN, D_Q - 1.0, tq / 2 + 0.05, (yq - dwq) / 2)
    col(X_FB, 0, D_MAIN, D_F - 1.0, tf / 2 + 0.05, yf)
    yp, dwp, tpk = bulkhead(X_PF, D_Q, D_P - 0.28, door=True, facing=1)
    col(X_PF, (yp + dwp) / 2, D_Q, D_P - 1.0, tpk / 2 + 0.05, (yp - dwp) / 2)
    col(X_PF, -(yp + dwp) / 2, D_Q, D_P - 1.0, tpk / 2 + 0.05, (yp - dwp) / 2)

    # stern gallery + transom crest + side windows of the cabin
    for (zg, wys, hh) in ((D_MAIN + 1.55, (-2.55, -0.85, 0.85, 2.55), 1.25), (D_Q + 1.35, (-1.9, 0.0, 1.9), 1.05)):
        for wy in wys:
            wbox((0.1, 1.2, hh), (XS - 0.05, wy, zg), M_WARM)
            wbox((0.24, 1.46, 0.16), (XS - 0.12, wy, zg + hh / 2 + 0.08), M_TIMBER, grain=1)
            wbox((0.24, 1.46, 0.16), (XS - 0.12, wy, zg - hh / 2 - 0.08), M_TIMBER, grain=1)
            wbox((0.24, 0.14, hh + 0.1), (XS - 0.12, wy + 0.66, zg), M_TIMBER, grain=2)
            wbox((0.24, 0.14, hh + 0.1), (XS - 0.12, wy - 0.66, zg), M_TIMBER, grain=2)
            # leaded lights: two mullions and a transom bar just proud of the
            # glass, a brass drip under the sill - a gallery window, not a slot
            for my in (-0.2, 0.2):
                wbox((0.07, 0.07, hh), (XS - 0.15, wy + my, zg), M_TIMBER, grain=2)
            wbox((0.07, 1.2, 0.07), (XS - 0.15, wy, zg), M_TIMBER, grain=1)
            wbox((0.16, 1.5, 0.08), (XS - 0.2, wy, zg - hh / 2 - 0.2), M_BRASS, K=K_BRASS)
        # a stern balcony under each gallery: plank floor, brass-capped balustrade
        bz = zg - hh / 2 - 0.35
        hw = inner_y(XS, bz) - 0.1
        slab([(XS - 1.05, -hw), (XS, -hw), (XS, hw), (XS - 1.05, hw)], bz, 0.2, M_DECK, K_DECK)
        wbox((0.2, 2 * hw, 0.14), (XS - 0.95, 0, bz + 0.95), M_BRASS, K=K_BRASS)
        nposts = int(2 * hw / 0.55) + 1
        for i in range(nposts):
            wbox((0.1, 0.1, 0.9), (XS - 0.95, -hw + 2 * hw * i / (nposts - 1), bz + 0.45), M_TIMBER, grain=2)
        for sy in (-1, 1):
            beam((XS - 1.0, sy * hw, bz - 0.1), (XS, sy * hw * 0.9, bz - 1.1), 0.14, 0.14)
    zc = top_z(XS) - 1.0
    crystal((XS - 0.3, 0, zc), 1.0, 0.75, M_BRASS, n=4, axis='x')
    crystal((XS - 0.45, 0, zc), 0.6, 0.45, M_RUNE, n=4, axis='x')
    for side in (-1, 1):
        for (wx, z) in ((-14.6, D_MAIN + 1.45), (-11.2, D_MAIN + 1.45), (-15.2, D_Q + 1.3)):
            y = side * (breadth(wx, z) + 0.04)
            wbox((1.0, 0.1, 1.0), (wx, y, z), M_WARM)
            wbox((1.24, 0.2, 0.14), (wx, y, z + 0.58), M_BRASS, K=K_BRASS)
            wbox((1.24, 0.2, 0.14), (wx, y, z - 0.58), M_BRASS, K=K_BRASS)
            # brass jambs close the frame; a timber cross over the glass
            # splits it into four lights like the cabin's casements
            for jx in (-1, 1):
                wbox((0.14, 0.2, 1.3), (wx + jx * 0.55, y, z), M_BRASS, K=K_BRASS)
            wbox((1.0, 0.07, 0.07), (wx, y + side * 0.07, z), M_TIMBER, grain=0)
            wbox((0.07, 0.07, 1.0), (wx, y + side * 0.07, z), M_TIMBER, grain=2)

    # stern lanterns on the taffrail, bow lantern
    for side in (-1, 1):
        lx, ly, lz = XS + 0.2, side * (inner_y(XS, top_z(XS)) - 0.1), top_z(XS)
        beam((lx, ly, lz), (lx, ly, lz + 1.6), 0.16, 0.16, mat=M_IRON)
        beam((lx, ly, lz + 1.6), (lx - 0.9, ly, lz + 1.6), 0.12, 0.12, mat=M_IRON)
        # (every ship lantern is a size down from the first cut - at SPACEY's
        # ~3x placement they read as street lamps)
        lantern(lx - 0.9, ly, lz + 1.45, s=0.5, h=0.72)
    lantern(17.9, 0, top_z(17.9) + 1.7, s=0.4, h=0.55)
    beam((17.9, 0, top_z(17.9)), (17.9, 0, top_z(17.9) + 1.9), 0.14, 0.14, mat=M_IRON)

    # figurehead: brass crest on the stem, gilded scrolls
    fz = D_MAIN + 0.9
    crystal((XB + rake(XB, fz) + 0.35, 0, fz), 1.1, 1.0, M_BRASS, n=4, axis='x')
    crystal((XB + rake(XB, fz) + 0.55, 0, fz), 0.6, 0.55, M_RUNE, n=4, axis='x')
    for side in (-1, 1):
        pts = [Vector((XB + rake(XB, fz) - 0.4 - 1.6 * t, side * (0.3 + 1.0 * t), fz - 0.4 + 1.3 * math.sin(t * 2.4))) for t in [i / 6 for i in range(7)]]
        tube_along(bm, pts, 0.09, segs=5, mat=M_BRASS)

    # the waist ports are PLANKED OVER (no guns run out on a Warden trader):
    # a flush plank panel in the skin with brass battens top and bottom, so the
    # line of ports still reads along the hull without a muzzle in sight
    def port_cover(x, side):
        z = D_MAIN + RAIL + 0.8 * ((x - 0.5) / 18.0) ** 2 - 3.65
        dB = (breadth(x + 0.4, z) - breadth(x - 0.4, z)) / 0.8
        n = Vector((-dB, side, 0.0)).normalized()
        t = Vector((n.y, -n.x, 0.0)) * side
        up = Vector((0.0, 0.0, 1.0))
        M = Matrix((t, n, up)).transposed()
        c = Vector((x, side * breadth(x, z), z))
        wbox((1.18, 0.14, 1.04), c + n * 0.03, M_HULL, K=K_HULL, rot=M, grain=0)
        for s_ in (-1, 1):
            wbox((1.3, 0.1, 0.12), c + n * 0.07 + up * s_ * 0.52, M_BRASS, K=K_BRASS, rot=M)
    for gx in (-6.0, -3.3, -0.6, 2.1, 5.6, 8.3):
        for side in (-1, 1):
            port_cover(gx, side)

    # anchors: chunky cartoon irons hung from catheads, their arms spread
    # fore and aft in a plane well clear of the bow's flare
    def anchor(cx, cy, zring):
        torus(bm, 0.42, 0.12, major=14, minor=6, mat=M_IRON, center=(cx, cy, zring), axis='Y')
        zs = zring - 0.62                       # the stock, square across the arms
        rod((cx, cy - 1.15, zs), (cx, cy + 1.15, zs), 0.15, M_IRON, segs=8)
        for sy in (-1, 1):
            crystal((cx, cy + sy * 1.22, zs), 0.22, 0.22, M_BRASS, n=6)
        zc = zring - 3.25                       # the crown
        rod((cx, cy, zring - 0.3), (cx, cy, zc + 0.2), 0.24, M_IRON, segs=10, r1=0.28)
        for zb in (zring - 1.1, zc + 0.65):
            rod((cx, cy, zb - 0.07), (cx, cy, zb + 0.07), 0.32, M_BRASS, segs=10, K=K_BRASS)
        crystal((cx, cy, zc), 0.42, 0.34, M_IRON, n=8)
        for sx in (-1, 1):
            arm = [Vector((cx + sx * 1.35 * t, cy, zc + 0.05 + 1.25 * t ** 1.7)) for t in [i / 6 for i in range(7)]]
            tube_along(bm, arm, 0.2, segs=8, mat=M_IRON)
            tip = arm[-1]
            fluke = Matrix.Rotation(sx * math.radians(38), 3, 'Y')
            wbox((0.95, 0.2, 0.75), tip + Vector((-sx * 0.12, 0, 0.12)), M_IRON, rot=fluke)
            pyramid(tip.x + sx * 0.18, cy, tip.z + 0.45, 0.14, 0.4, M_BRASS)
    for side in (-1, 1):
        ax = 14.4
        zring = D_F - 0.1
        clear = max(breadth(x, z) for x in (12.6, 13.4, 14.4, 15.4, 16.2)
                    for z in (zring - 3.5, zring - 2.0, zring - 0.5, zring))
        ay = side * (clear + 0.75)
        # the cathead: a stout brass-capped beam out of the bow bulwark
        zt = top_z(ax) - 0.35
        yi = side * (breadth(ax, zt) - 0.4)
        beam((ax, yi, zt), (ax, ay + side * 0.35, zring + 0.55), 0.42, 0.42)
        rod((ax, ay + side * 0.35, zring + 0.55), (ax, ay + side * 0.6, zring + 0.6), 0.28, M_BRASS, segs=8, K=K_BRASS)
        rope((ax, ay, zring + 0.5), (ax, ay, zring + 0.42), 0.02, r=0.09, n=3)
        anchor(ax, ay, zring)

    # ==== stairs ================================================================
    def flight(x_top, x_bot, y, z_bot, z_top, w=1.4, riser=0.26):
        """A flight rising from (x_bot, z_bot) to the deck edge (x_top, z_top) at
        lateral y: n risers and n - 1 treads, the deck itself the last step. Its
        walkable ramp runs through the tread NOSINGS, from one riser over the
        lower deck at the foot to the upper deck at the head, so a walker's
        feet ride the step edges and never sink into a tread."""
        run = x_top - x_bot
        rise = z_top - z_bot
        n = max(2, round(rise / riser))
        rz = rise / n
        g = run / (n - 1)
        for k in range(n - 1):
            xt = x_bot + g * (k + 0.5)
            zt = z_bot + rz * (k + 1)
            wbox((abs(g) + 0.04, w, 0.1), (xt, y, zt - 0.05), M_DECK, K=K_DECK, grain=1, tex='u')
            wbox((0.05, w - 0.02, rz - 0.1), (x_bot + g * k, y, zt - 0.1 - (rz - 0.1) / 2), M_TIMBER, grain=1)
        for sy in (-1, 1):
            beam((x_bot, y + sy * (w / 2 + 0.08), z_bot - 0.15), (x_top, y + sy * (w / 2 + 0.08), z_top - 0.25), 0.16, 0.5)
        # rope hand line on the inboard side
        yi = y - math.copysign(w / 2 + 0.1, y)
        for f in (0.05, 0.95):
            xp = x_bot + run * f
            zp = z_bot + rise * f
            wbox((0.14, 0.14, 1.2), (xp, yi, zp + 0.6), M_TIMBER, grain=2)
        rope((x_bot + run * 0.05, yi, z_bot + rise * 0.05 + 1.05), (x_bot + run * 0.95, yi, z_bot + rise * 0.95 + 1.05), 0.12)
        cx = (x_top + x_bot) / 2
        ramp(cx, y, abs(run) / 2, w / 2, z_bot + rz, z_top, ry=0.0 if run > 0 else math.pi)
    # one flight up to the poop, port side, inboard of the tumblehome (the poop
    # deck is only ~2.7 each side of the keel line at its front)
    flight(X_PF, X_PF + 3.8, 1.9, D_Q, D_P, w=1.3)
    for sy in (-1, 1):
        # inboard enough that each head lands on its deck with a body's width
        # between the balustrade and the bulwark (the forecastle is only ~2.2
        # each side of the keel line at its front)
        flight(X_QF, X_QF + 4.4, sy * 3.1, D_MAIN, D_Q)
        flight(X_FB, X_FB - 3.6, sy * 1.65, D_MAIN, D_F)


    # castle-edge balustrades, with openings at the stair heads
    def balustrade(x, z, y_edge, gaps, face=1):
        ys = sorted([-y_edge, y_edge] + [g for gp in gaps for g in gp])
        for a, b in zip(ys[0::2], ys[1::2]):
            if b - a < 0.3:
                continue
            nposts = max(2, int((b - a) / 0.9) + 1)
            for i in range(nposts):
                yy = a + (b - a) * i / (nposts - 1)
                wbox((0.16, 0.16, 1.05), (x, yy, z + 0.52), M_TIMBER, grain=2)
            wbox((0.24, b - a, 0.14), (x, (a + b) / 2, z + 1.1), M_TIMBER, grain=1)
            wbox((0.12, b - a, 0.1), (x, (a + b) / 2, z + 0.42), M_TIMBER, grain=1)
            col(x, (a + b) / 2, z, z + 1.2, 0.2, (b - a) / 2)
    eq, ef, ep = inner_y(X_QF, D_Q), inner_y(X_FB, D_F), inner_y(X_PF, D_P)
    balustrade(X_QF + 0.1, D_Q, eq, [(-eq - 0.01, -2.3), (2.3, eq + 0.01)])
    balustrade(X_FB - 0.1, D_F, ef, [(-ef - 0.01, -0.85), (0.85, ef + 0.01)])
    balustrade(X_PF + 0.1, D_P, ep, [(1.05, ep + 0.01)])

    # ==== deck furniture ========================================================
    # ship's wheel on the quarterdeck, forward of the mizzen
    wx = -8.8
    wbox((0.6, 0.5, 1.1), (wx, 0, D_Q + 0.55), M_TIMBER, grain=2)
    torus(bm, 0.78, 0.07, major=16, minor=4, mat=M_TIMBER, center=(wx + 0.35, 0, D_Q + 1.55), axis='X')
    for k in range(8):
        a = TAU * k / 8
        p0 = Vector((wx + 0.35, 0.12 * math.cos(a), D_Q + 1.55 + 0.12 * math.sin(a)))
        p1 = Vector((wx + 0.35, 1.0 * math.cos(a), D_Q + 1.55 + 1.0 * math.sin(a)))
        beam(p0, p1, 0.06, 0.06)
    rod((wx + 0.2, 0, D_Q + 1.55), (wx + 0.5, 0, D_Q + 1.55), 0.16, M_BRASS, segs=8, K=K_BRASS)
    col(wx, 0, D_Q, D_Q + 1.6, 0.45, 0.9)
    # capstan between the quarterdeck stairs, clear of the cabin door
    cxp = -3.6
    rod((cxp, 0, D_MAIN), (cxp, 0, D_MAIN + 1.05), 0.55, M_TIMBER, segs=12)
    rod((cxp, 0, D_MAIN + 1.05), (cxp, 0, D_MAIN + 1.2), 0.62, M_BRASS, segs=12, K=K_BRASS)
    for k in range(4):
        a = TAU * k / 8
        beam((cxp - 1.3 * math.cos(a), -1.3 * math.sin(a), D_MAIN + 0.85), (cxp + 1.3 * math.cos(a), 1.3 * math.sin(a), D_MAIN + 0.85), 0.09, 0.09)
    col(cxp, 0, D_MAIN, D_MAIN + 1.2, 0.62, 0.62)
    # main hatch with a grating
    hx0 = 4.3
    wbox((3.0, 2.6, 0.36), (hx0, 0, D_MAIN + 0.18), M_TIMBER, grain=0)
    for k in range(7):
        wbox((0.14, 2.3, 0.05), (hx0 - 1.2 + k * 0.4, 0, D_MAIN + 0.38), M_TIMBER, grain=1)
    for k in range(5):
        wbox((2.6, 0.12, 0.05), (hx0, -0.9 + k * 0.45, D_MAIN + 0.4), M_TIMBER, grain=0)
    col(hx0, 0, D_MAIN, D_MAIN + 0.42, 1.5, 1.3)
    # cargo lashed on the quarterdeck's starboard side, aft of the stair head
    # and clear of the wheel and the poop flight (port)
    for (cx, cy, s, z0) in ((-10.6, -2.95, 0.95, 0.0), (-10.58, -2.93, 0.7, 0.95)):
        wbox((s, s, s), (cx, cy, D_Q + z0 + s / 2), M_DECK, K=1.3, grain=0, tex='u')
        wbox((s + 0.04, 0.08, s + 0.04), (cx, cy, D_Q + z0 + s / 2), M_ROPE)
    col(-10.6, -2.95, D_Q, D_Q + 1.65, 0.52, 0.52)
    for (bx, by) in ((-11.75, -2.85), (-12.45, -2.6)):
        rod((bx, by, D_Q), (bx, by, D_Q + 1.0), 0.42, M_TIMBER, segs=10)
        for z in (0.2, 0.8):
            rod((bx, by, D_Q + z - 0.04), (bx, by, D_Q + z + 0.04), 0.44, M_IRON, segs=10)
    col(-12.1, -2.72, D_Q, D_Q + 1.0, 0.8, 0.5)

    # ==== masts, yards, sails, rigging ==========================================
    MASTS = {   # x, step (deck), lower top, top-mast top, top-gallant top, radius
        'fore': (8.8, D_MAIN, RIG(20.5), RIG(27.0), RIG(31.5), 0.64),
        'main': (0.0, D_MAIN, RIG(22.5), RIG(29.5), RIG(35.5), 0.74),
        'mizzen': (-10.6, D_Q, RIG(20.5), RIG(26.2), RIG(29.0), 0.52),   # 1.9 clear of the upper cabin door
    }
    for name, (mx, step, t1, t2, t3, r) in MASTS.items():
        rod((mx, 0, step), (mx, 0, t1 + 0.6), r, M_TIMBER, segs=10, r1=r * 0.85)
        rod((mx, 0, t1 - 1.6), (mx, 0, t2 + 0.5), r * 0.62, M_TIMBER, segs=8, r1=r * 0.5)
        rod((mx, 0, t2 - 1.2), (mx, 0, t3), r * 0.4, M_TIMBER, segs=8, r1=r * 0.3)
        for z in range(int(step + 2), int(t1), 3):
            rod((mx, 0, z - 0.1), (mx, 0, z + 0.1), r + 0.06, M_BRASS, segs=10, K=K_BRASS)
        if name == 'main':
            wbox((0.9, 0.9, 0.5), (mx, 0, t1 + 0.6), M_TIMBER, grain=2)
            pyramid(mx, 0, t3, 0.18, 0.45, M_BRASS)
            col(mx, 0, step, step + 12.0, r + 0.08, r + 0.08)
            continue   # the main top is the climbable crow's nest, built below
        # the top: a round platform with a rim, and the cap on the lower mast
        n = 12
        pr = 1.5 if name != 'mizzen' else 1.15
        pts = [(mx + pr * math.cos(TAU * i / n), pr * math.sin(TAU * i / n)) for i in range(n)]
        slab(pts, t1 + 0.12, 0.22, M_DECK, K_DECK)
        for i in range(n):
            j = (i + 1) % n
            beam((pts[i][0], pts[i][1], t1 + 0.45), (pts[j][0], pts[j][1], t1 + 0.45), 0.08, 0.08)
        wbox((0.9, 0.9, 0.5), (mx, 0, t1 + 0.6), M_TIMBER, grain=2)
        pyramid(mx, 0, t3, 0.18, 0.45, M_BRASS)
        col(mx, 0, step, step + 12.0, r + 0.08, r + 0.08)
    # Warden pennants streaming aft from the three trucks
    def pennant(mx, mt, length, width, seed):
        # UVs run 0 at the hoist to 1 at the fly; ACROSS the flag they sit in a
        # narrow band at `seed`. The renderer's wind shader (render/ship_wind.ts)
        # reads u as "how free is this point to flap" and v as this pennant's
        # own phase, so the three fly out of step with each other instead of
        # snapping in unison (they are all one object: without a per-flag seed
        # the shader has nothing to tell them apart).
        for dy in (0.012, -0.012):
            seg = 6
            top, bot = [], []
            for i in range(seg + 1):
                tt = i / seg
                x = mx - 0.3 - length * tt
                w = width * (1 - 0.6 * tt)
                y = dy + 0.25 * math.sin(tt * 2.4 * math.pi) * tt
                top.append(bm.verts.new((x, y, mt - 0.6 + w)))
                bot.append(bm.verts.new((x, y, mt - 0.6 - w)))
            for i in range(seg):
                q = [bot[i], bot[i + 1], top[i + 1], top[i]]
                # the v band is a hair wide on purpose: the shader turns v into
                # this flag's phase, so it must be the SAME value all across
                uv = [(i / seg, seed), ((i + 1) / seg, seed),
                      ((i + 1) / seg, seed + 0.001), (i / seg, seed + 0.001)]
                if dy <= 0:
                    q, uv = list(reversed(q)), list(reversed(uv))
                f = bm.faces.new(q)
                f.material_index = M_CLOTH
                for loop, t in zip(f.loops, uv):
                    loop[uvl].uv = t
    # seeds on SIXTEENTHS: the wind shader snaps v to the nearest sixteenth so
    # every vertex of one pennant flaps on exactly one phase and rate
    pennant(MASTS['main'][0], MASTS['main'][4], 4.6, 0.48, 2 / 16)
    pennant(MASTS['fore'][0], MASTS['fore'][4], 3.0, 0.36, 7 / 16)
    pennant(MASTS['mizzen'][0], MASTS['mizzen'][4], 2.6, 0.32, 13 / 16)

    def sail(x, z_top, z_bot, hw_top, hw_bot, billow, mat, nu=8, nv=6):
        """A square sail hung under a yard at mast x, billowed forward (+X)."""
        rows = []
        for i in range(nv + 1):
            v = i / nv
            z = z_top + (z_bot - z_top) * v
            hw = hw_top + (hw_bot - hw_top) * v
            row = []
            for j in range(nu + 1):
                u = j / nu
                y = -hw + 2 * hw * u
                b = billow * math.sin(math.pi * u) * (0.45 + 0.55 * math.sin(math.pi * min(1.0, v * 0.95 + 0.05)))
                b += billow * 0.25 * v * v
                row.append(bm.verts.new((x + 0.35 + b, y, z)))
            rows.append(row)
        for i in range(nv):
            for j in range(nu):
                f = bm.faces.new([rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]])
                f.material_index = mat
                f.smooth = True
                for loop, uv in zip(f.loops, [(j / nu, 1 - i / nv), (j / nu, 1 - (i + 1) / nv),
                                               ((j + 1) / nu, 1 - (i + 1) / nv), ((j + 1) / nu, 1 - i / nv)]):
                    loop[uvl].uv = uv
        # the yard it hangs from, with brass yard-arm caps and a sling
        rod((x + 0.35, -hw_top - 0.9, z_top + 0.25), (x + 0.35, hw_top + 0.9, z_top + 0.25), 0.2, M_TIMBER, segs=8)
        for s in (-1, 1):
            rod((x + 0.35, s * (hw_top + 0.75), z_top + 0.25), (x + 0.35, s * (hw_top + 0.95), z_top + 0.25), 0.23, M_BRASS, segs=8, K=K_BRASS)
    # Deep and a touch narrower: square sails read as canvas when they are
    # nearly as tall as they are wide (the first cut was half that and looked
    # squashed). Each drops to about 2.4 over the deck it hangs above and
    # climbs into the gap under the next yard; the main topsail still starts
    # above the crow's nest rail.
    SAILS = [   # mast, z_top, z_bot, hw_top, hw_bot, billow, crest
        ('fore', 19.9, 13.6, 6.3, 7.0, 1.4, False),
        ('fore', 26.6, 20.4, 4.9, 5.9, 1.5, False),
        ('fore', 31.2, 27.1, 3.5, 4.4, 1.1, False),
        ('main', 21.6, 13.2, 7.4, 8.1, 2.2, True),
        ('main', 29.4, 24.6, 5.4, 6.2, 1.5, False),   # its foot clears the crow's nest rail
        ('main', 35.2, 29.9, 4.0, 4.9, 1.1, False),
        ('mizzen', 26.0, 20.9, 4.0, 4.7, 1.2, False),
    ]
    for (m, zt, zb, ht, hb, bi, crest) in SAILS:
        sail(MASTS[m][0], RIG(zt), RIG(zb), ht, hb, bi, M_CREST if crest else M_SAIL)

    def tri_sail(a, b, c, bulge, mat, n=6):
        a, b, c = Vector(a), Vector(b), Vector(c)
        verts = {}
        for i in range(n + 1):
            for j in range(n + 1 - i):
                u, v = i / n, j / n
                w = 1 - u - v
                p = a * w + b * u + c * v
                p = p + Vector((0, bulge * 4 * u * v * w * 2.2 + bulge * 0.2, 0))
                verts[(i, j)] = (bm.verts.new(p), (u + 0.5 * v, v))
        for i in range(n):
            for j in range(n - i):
                tris = [((i, j), (i + 1, j), (i, j + 1))]
                if i + j + 1 < n:
                    tris.append(((i + 1, j), (i + 1, j + 1), (i, j + 1)))
                for tri in tris:
                    f = bm.faces.new([verts[k][0] for k in tri])
                    f.material_index = mat
                    f.smooth = True
                    for loop, k in zip(f.loops, tri):
                        loop[uvl].uv = verts[k][1]
    # bowsprit + jib boom, two jibs, the spanker on the mizzen
    bs0 = Vector((16.6, 0, D_F + 0.3))
    bs1 = Vector((27.6, 0, D_F + 5.6))
    rod(bs0, bs1, 0.42, M_TIMBER, segs=10, r1=0.26)
    for t in (0.35, 0.7):
        p = bs0.lerp(bs1, t)
        rod(p - Vector((0.1, 0, 0.04)), p + Vector((0.1, 0, 0.04)), 0.46 - 0.12 * t, M_BRASS, segs=10, K=K_BRASS)
    fx = MASTS['fore'][0]
    # Both jibs live wholly AHEAD of the foremast's canvas. A square sail hangs
    # forward of its mast and bellies further forward still (the fore course
    # and topsail reach x ~ 11.0); the jib heads used to sit 0.7 ahead of the
    # mast, so both leeches cut straight through those sails (SPACEY's shot).
    # Now each head rides its own stay well down from the masthead - a jib's
    # luff IS the stay - and the clews stay ahead of the bellies too.
    stay_outer = (P(fx, 0, RIG(31.0)), bs1)
    stay_inner = (P(fx, 0, RIG(20.6)), bs0.lerp(bs1, 0.5))
    tri_sail(stay_outer[0].lerp(stay_outer[1], 0.26), (26.8, 0, D_F + 5.3), (15.6, 0, D_F + 3.3), 0.85, M_SAIL)
    tri_sail(stay_inner[0].lerp(stay_inner[1], 0.34), (21.9, 0, D_F + 2.85), (14.6, 0, D_F + 2.3), 0.6, M_SAIL)
    mzx = MASTS['mizzen'][0]
    gaff0, gaff1 = Vector((mzx - 0.6, 0, RIG(24.4))), Vector((-19.6, 0, RIG(29.2)))
    boom0, boom1 = Vector((mzx - 0.6, 0, D_P + 2.4)), Vector((-21.2, 0, D_P + 2.6))
    rod(gaff0, gaff1, 0.2, M_TIMBER, segs=8)
    rod(boom0, boom1, 0.24, M_TIMBER, segs=8)
    rows = []
    nv, nu = 5, 6
    for i in range(nv + 1):
        v = i / nv
        row = []
        for j in range(nu + 1):
            u = j / nu
            top = gaff0.lerp(gaff1, u)
            bot = boom0.lerp(boom1, u)
            p = top.lerp(bot, v) + Vector((0, 0.9 * math.sin(math.pi * u) * math.sin(math.pi * v), 0))
            row.append(bm.verts.new(p))
        rows.append(row)
    for i in range(nv):
        for j in range(nu):
            f = bm.faces.new([rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]])
            f.material_index = M_SAIL
            f.smooth = True
            for loop, uv in zip(f.loops, [(j / nu, 1 - i / nv), ((j + 1) / nu, 1 - i / nv),
                                           ((j + 1) / nu, 1 - (i + 1) / nv), (j / nu, 1 - (i + 1) / nv)]):
                loop[uvl].uv = uv
    # stays
    mxm, mxf = MASTS['main'][0], MASTS['fore'][0]
    rod((fx, 0, RIG(31.0)), bs1, 0.06, M_ROPE, segs=5, caps=False)
    rod((fx, 0, RIG(20.6)), bs0.lerp(bs1, 0.5), 0.07, M_ROPE, segs=5, caps=False)
    rod((mxm, 0, RIG(35.0)), (fx, 0, RIG(27.0)), 0.06, M_ROPE, segs=5, caps=False)
    rod((mxm + 0.8, 0, RIG(22.5) - 0.9), (fx, 0, D_MAIN + 0.8), 0.07, M_ROPE, segs=5, caps=False)   # under the nest
    rod((mzx, 0, RIG(28.5)), (mxm, 0, RIG(25.0)), 0.05, M_ROPE, segs=5, caps=False)
    # shroud nets: from each lower top down to the channels outside the bulwarks
    for name, (mx, step, t1, t2, t3, r) in MASTS.items():
        if name == 'main':
            continue   # the main mast is climbed by its ladder; its sides carry the landings
        spread = 2.2 if name != 'mizzen' else 1.7
        for side in (-1, 1):
            zc = top_z(mx) - 0.2
            yc = side * (breadth(mx, zc) + 0.35)
            a = Vector((mx - 0.55, side * (r + 0.2), t1 - 0.2))
            b = Vector((mx + 0.55, side * (r + 0.2), t1 - 0.2))
            c = Vector((mx + spread, yc, zc))
            d = Vector((mx - spread, yc, zc))
            q = [d, c, b, a] if side > 0 else [a, b, c, d]
            f = bm.faces.new([bm.verts.new(p) for p in q])
            f.material_index = M_NET
            width = 2 * spread
            height = (a - d).length
            uvs = {id(d): (0.0, 0.0), id(c): (width / 2.2, 0.0), id(b): (width / 2.2 * 0.62, height / 2.6), id(a): (width / 2.2 * 0.38, height / 2.6)}
            for loop, p in zip(f.loops, q):
                loop[uvl].uv = uvs[id(p)]
            # the channel (a brass-capped ledge) and deadeyes
            wbox((2 * spread + 0.6, 0.35, 0.22), (mx, yc, zc - 0.1), M_TIMBER, grain=0)
            wbox((2 * spread + 0.64, 0.4, 0.06), (mx, yc, zc + 0.02), M_BRASS, K=K_BRASS)

    # ==== the crow's nest and its ladder ========================================
    # The main top is a lookout players climb to: a square nest on crosstrees,
    # a timber balustrade round it, and a hatch where the ladder up the mast's
    # aft face comes through (sim/ladders.ts climbs it).
    mmx, mstep, mt1, mt2, mt3, mr = MASTS['main']
    NEST = 2.3
    zn = mt1 + 0.12
    for sy in (-1, 1):
        beam((mmx - NEST, sy * 0.95, zn - 0.5), (mmx + NEST, sy * 0.95, zn - 0.5), 0.24, 0.34)
    for sx in (-1, 1):
        beam((mmx + sx * 0.95, -NEST, zn - 0.84), (mmx + sx * 0.95, NEST, zn - 0.84), 0.24, 0.34)
    hx0, hx1, hy = mmx - 1.95, mmx - 0.88, 0.58      # the hatch
    for poly in ([(mmx - NEST, hy), (mmx + NEST, hy), (mmx + NEST, NEST), (mmx - NEST, NEST)],
                 [(mmx - NEST, -NEST), (mmx + NEST, -NEST), (mmx + NEST, -hy), (mmx - NEST, -hy)],
                 [(hx1, -hy), (mmx + NEST, -hy), (mmx + NEST, hy), (hx1, hy)],
                 [(mmx - NEST, -hy), (hx0, -hy), (hx0, hy), (mmx - NEST, hy)]):
        slab(poly, zn, 0.2, M_DECK, K_DECK)
    for (a, b) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
        pa = Vector((mmx + a[0] * (NEST - 0.08), a[1] * (NEST - 0.08), zn))
        pb = Vector((mmx + b[0] * (NEST - 0.08), b[1] * (NEST - 0.08), zn))
        for k in range(4):
            q = pa.lerp(pb, k / 3)
            wbox((0.16, 0.16, 1.05), (q.x, q.y, zn + 0.52), M_TIMBER, grain=2)
        mid = (pa + pb) / 2
        d = pb - pa
        beam((pa.x, pa.y, zn + 1.08), (pb.x, pb.y, zn + 1.08), 0.2, 0.14, mat=M_BRASS, K=K_BRASS)
        beam((pa.x, pa.y, zn + 0.5), (pb.x, pb.y, zn + 0.5), 0.1, 0.1)
        horiz = abs(d.x) > abs(d.y)
        col(mid.x, mid.y, zn, zn + 1.15, (NEST if horiz else 0.12), (0.12 if horiz else NEST))
    for sy in (-1, 1):
        lantern(mmx + NEST - 0.08, sy * (NEST - 0.08), zn + 1.75, s=0.34, h=0.45)
        beam((mmx + NEST - 0.08, sy * (NEST - 0.08), zn + 1.05), (mmx + NEST - 0.08, sy * (NEST - 0.08), zn + 1.35), 0.1, 0.1, mat=M_IRON)
    ramp(mmx, 0.0, NEST - 0.12, NEST - 0.12, zn)
    # the ladder: two rails and rungs up the mast's aft face, through the hatch,
    # the rails running on up as grab handles; brackets stand it off the mast
    lx = mmx - (mr + 0.12)
    for sy in (-1, 1):
        rod((lx, sy * 0.42, mstep), (lx, sy * 0.42, zn + 0.95), 0.06, M_TIMBER, segs=6)
        crystal((lx, sy * 0.42, zn + 1.0), 0.08, 0.08, M_BRASS, n=4)
    z = mstep + 0.3
    while z < zn - 0.15:
        rod((lx, -0.42, z), (lx, 0.42, z), 0.045, M_TIMBER, segs=5, caps=False)
        z += 0.34
    for zb in (mstep + 2.2, mstep + 5.0, mstep + 7.8):
        beam((lx, 0, zb), (mmx - mr + 0.05, 0, zb), 0.1, 0.1, mat=M_IRON)
    LADDERS.append((lx, 0.0, mstep, zn, 0.42, math.pi))

    # ==== boarding landings =====================================================
    # A plank platform overhangs each gangway port, so players step on and off
    # at the pier's own height (world 6.08 floated) from either side: timber
    # rails fore and aft, brass caps, the outer end open to the berth.
    LAND = 1.55                       # the jut: short enough to read as a step-off
    lx0, lx1 = GANG[0] - 0.2, GANG[1] + 0.2
    for side in (-1, 1):
        yb = max(breadth(x, D_MAIN) for x in (lx0, lx1, (lx0 + lx1) / 2))
        yo = yb + LAND
        poly = [(lx0, side * (yb - 0.25)), (lx1, side * (yb - 0.25)), (lx1, side * yo), (lx0, side * yo)]
        slab(poly if side > 0 else poly[::-1], D_MAIN, 0.24, M_DECK, K_DECK)
        beam((lx0, side * yo, D_MAIN - 0.3), (lx1, side * yo, D_MAIN - 0.3), 0.3, 0.36)
        # the bearers run from INSIDE the planking out to the fascia, and the
        # knees under them start buried in the hull and land on that fascia:
        # every support meets both the boat and the platform, no floating ends
        for x in (lx0 + 0.35, (lx0 + lx1) / 2, lx1 - 0.35):
            beam((x, side * (breadth(x, D_MAIN - 0.36) - 0.5), D_MAIN - 0.36),
                 (x, side * (yo - 0.12), D_MAIN - 0.36), 0.22, 0.26)
        for x in (lx0 + 0.35, lx1 - 0.35):
            beam((x, side * (breadth(x, D_MAIN - 2.3) - 0.3), D_MAIN - 2.3),
                 (x, side * (yo - 0.18), D_MAIN - 0.42), 0.26, 0.3)
        for x in (lx0 + 0.08, lx1 - 0.08):
            for k in range(3):
                y = yb + (yo - 0.15 - yb) * k / 2
                wbox((0.16, 0.16, 1.05), (x, side * y, D_MAIN + 0.52), M_TIMBER, grain=2)
            beam((x, side * (yb - 0.1), D_MAIN + 1.08), (x, side * (yo - 0.05), D_MAIN + 1.08), 0.2, 0.14, mat=M_BRASS, K=K_BRASS)
            beam((x, side * yb, D_MAIN + 0.5), (x, side * (yo - 0.1), D_MAIN + 0.5), 0.1, 0.1)
            col(x, side * (yb + yo) / 2, D_MAIN, D_MAIN + 1.15, 0.13, (yo - yb) / 2 + 0.05)
            # stout end posts at the open end, each capped by its own lantern.
            # NOTHING reaches out over the gap a player steps across: the old
            # iron arm hung a bar right over the entrance.
            wbox((0.3, 0.3, 1.7), (x, side * (yo - 0.12), D_MAIN + 0.85), M_TIMBER, grain=2)
            lantern(x, side * (yo - 0.12), D_MAIN + 2.25, s=0.28, h=0.38)
        # the deck runs on inboard over the main deck's own slices (the one
        # forward of x 4.85 is the narrower), so the port has no seam
        yi = 3.4
        ramp((lx0 + lx1) / 2, side * (yi + yo) / 2, (lx1 - lx0) / 2, (yo - yi) / 2, D_MAIN)

    # ==== collision =============================================================
    # walkable decks: rectangles inside the bulwarks, sliced where the hull narrows
    # 16 decks and <= 64 boxes in all: the Studio's Collision Master keeps that
    # many per placement (MAX_PLACEMENT_RAMPS / _HITBOXES). The cuts put the
    # short slices where the hull tapers, so every spot a body can reach
    # inside the walls has a floor; the bow rakes forward with height, so
    # stations map to world x through rake() exactly like the deck slabs.
    def slice_hw(a, b, z, raised):
        """Half width of a deck slice. The main deck keeps inside the inner
        skin (the hull tops floor its margins). A RAISED deck has nothing
        under its margins but the room below, and a placement grown a few
        times in plan brings a body to within a hand of its walls, so it runs
        out to the hull's outer skin at the slice's narrowest point: into the
        wall boxes at the wide end, never outside the hull."""
        xs = [a + (b - a) * i / 16 for i in range(17)]
        if raised:
            return min(inner_y(x, z) + BW for x in xs) - 0.04
        return min(inner_y(a, z), inner_y(b, z), inner_y((a + b) / 2, z)) - 0.05

    def deck_ramps(cuts, z, raised=False):
        for a, b in zip(cuts[:-1], cuts[1:]):
            hw = slice_hw(a, b, z, raised)
            wa, wb = a + rake(a, z), b + rake(b, z)
            if hw > 0.6:
                ramp((wa + wb) / 2, 0.0, (wb - wa) / 2 + 0.02, hw, z)
    # The two decks roofing a cabin are STANDABLE SLABS (boxes), not ramp
    # decks: a ramp deck is raised ground with no underside, so a hop in the
    # cabin under it (feet + mantle + the 2.5 deck reach) would land the body
    # on it through the ceiling, and the wall standoff reads its edge as a
    # cliff at the cabin door. A box top only carries feet that reach it, and
    # a walker's head passes under it (the slabs are thin enough for that).
    def deck_slabs(cuts, z, thick):
        for a, b in zip(cuts[:-1], cuts[1:]):
            col((a + b) / 2, 0.0, z - thick, z, (b - a) / 2 + 0.02, slice_hw(a, b, z, True))
    x0 = XS + BW + 0.05
    deck_ramps([x0, -13.15, -10.15, 4.85, 8.35, X_FB], D_MAIN)
    deck_slabs([x0, -11.65, X_QF], D_Q, 0.3)
    deck_slabs([x0, X_PF], D_P, 0.2)
    deck_ramps([X_FB, 13.5, 15.5, 17.2], D_F, raised=True)
    # the breastwork closing the forecastle's raked stem ahead of its last
    # slice, where the bulwarks converge (a body grown small next to the
    # ship's scale could otherwise walk out into the tip with no floor)
    xb = 17.2 + rake(17.2, D_F)
    col(xb + 0.9, 0.0, D_F - 0.1, D_F + RAIL + 0.3, 0.9, 0.95)
    # bulwarks / castle walls: yawed boxes along each side, cabin walls full height
    # the walls follow the inner skin at the deck they rim (tumblehome), and an
    # inset thickens them inboard where a deck slice is narrower than the hull
    def side_walls(x0, x1, z0, z1, step, inset=0.0):
        zr = z1 - RAIL + 0.5
        xs = [x0]
        while xs[-1] < x1 - 1e-6:
            xs.append(min(x1, xs[-1] + step))
        for a, b in zip(xs[:-1], xs[1:]):
            for side in (-1, 1):
                ya = side * (inner_y(a, zr) + BW / 2 - inset / 2)
                yb = side * (inner_y(b, zr) + BW / 2 - inset / 2)
                wa, wb = a + rake(a, zr), b + rake(b, zr)
                L = math.hypot(wb - wa, yb - ya)
                col((wa + wb) / 2, (ya + yb) / 2, z0, z1, L / 2 + 0.05, 0.3 + inset / 2,
                    ry=math.atan2(yb - ya, wb - wa))
    side_walls(XS, X_PF, D_MAIN, D_P + RAIL, 2.2)
    side_walls(X_PF, X_QF, D_MAIN, D_Q + RAIL, 2.9, inset=0.16)
    side_walls(X_QF, GANG[0], D_MAIN, D_MAIN + RAIL, (GANG[0] - X_QF) / 3 + 1e-3)
    side_walls(GANG[1], X_FB, D_MAIN, D_MAIN + RAIL, (X_FB - GANG[1]) / 2 + 1e-3)
    side_walls(X_FB, 17.4, D_MAIN, D_F + RAIL, 2.14, inset=0.22)
    col(XS + BW / 2, 0, D_MAIN, D_P + RAIL, BW / 2 + 0.1, inner_y(XS, D_MAIN) + 0.2)   # transom
    # the hull body, sliced along the swim band so a swimmer meets the planks,
    # not a box a yard off them; its tops (a hair under the main deck, so a
    # placement stretched tall still has no step there) are also a standable
    # floor wherever the walls let a body past a deck's edge (the gangway ports)
    for a, b in zip([XS - 0.1, -15.0, -10.5, 5.5, 10.5, 13.8, 16.2],
                    [-15.0, -10.5, 5.5, 10.5, 13.8, 16.2, 17.6]):
        xa, xb = max(a, XS), min(b, XB)
        hw = max(breadth(xa + (xb - xa) * i / 8, z) for i in range(9)
                 for z in (Z_WL - 1.6, Z_WL - 0.8, Z_WL, Z_WL + 0.8, Z_WL + 1.6)) + 0.05
        base = max(0.0, min(keel_z(xa + (xb - xa) * i / 8) for i in range(9)) - 0.2)
        col((a + b) / 2, 0, base, D_MAIN - 0.02, (b - a) / 2, hw)
    LOG.append(f"hull stations={len(STATIONS)} sails={len(SAILS)}")

    tag = "wharf_galleon"
    if PIECE == 'gangplank':
        # the matching gangplank: low end on the galleon's main deck (world
        # water + D_MAIN - Z_WL), high end on a Warden pier (6.08)
        bm.free()
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.verify()
        COLL.clear()
        RAMPS.clear()
        LADDERS.clear()
        LEN, RISE, W = 5.6, 6.08 - (-2.0 + D_MAIN - Z_WL), 1.5
        T = 0.14
        ang = math.atan2(RISE, LEN)
        L = math.hypot(LEN, RISE)
        rot = Matrix.Rotation(-ang, 3, 'Y')
        c = Vector((LEN / 2, 0, RISE / 2 + T / 2))
        wbox((L, W, T), c, M_DECK, K=K_DECK, rot=rot, grain=0, tex='u')
        for k in range(9):
            t = (k + 0.5) / 9
            wbox((0.08, W - 0.1, 0.07), (LEN * t, 0, RISE * t + T + 0.035), M_TIMBER, grain=1)
        for sy in (-1, 1):
            for t in (0.06, 0.94):
                wbox((0.14, 0.14, 1.15), (LEN * t, sy * (W / 2 + 0.04), RISE * t + T + 0.55), M_TIMBER, grain=2)
            rope((LEN * 0.06, sy * (W / 2 + 0.04), RISE * 0.06 + T + 1.05), (LEN * 0.94, sy * (W / 2 + 0.04), RISE * 0.94 + T + 1.05), 0.14)
            col(LEN / 2, sy * (W / 2 + 0.06), 0, RISE + T + 1.2, LEN / 2, 0.12)
        for t in (0.0, 1.0):
            wbox((0.3, W + 0.1, 0.12), (LEN * t, 0, RISE * t + 0.06), M_IRON)
        ramp(LEN / 2, 0, LEN / 2, W / 2 - 0.05, T + 0.0, RISE + T)
        tag = "wharf_gangplank"

    # ---- finish: sidecar, object, export, shots ---------------------------------
    xs_ = [v.co.x for v in bm.verts]
    ys_ = [v.co.y for v in bm.verts]
    zs_ = [v.co.z for v in bm.verts]
    size = (max(xs_) - min(xs_), max(zs_) - min(zs_), max(ys_) - min(ys_))
    r4 = lambda v: round(v, 4)
    side = {
        'size': [r4(s) for s in size],
        'minY': r4(min(zs_)),
        'waterline': Z_WL,
        'boxes': [dict(x=r4(b[0]), y=r4((b[2] + b[3]) * 0.5), z=r4(-b[1]), hx=r4(b[4]),
                       hy=r4((b[3] - b[2]) * 0.5), hz=r4(b[5]), **({'ry': r4(b[6])} if b[6] else {}))
                  for b in COLL],
        'ramps': [dict(x=r4(d[0]), z=r4(-d[1]), hx=r4(d[2]), hz=r4(d[3]), y0=r4(d[4]), y1=r4(d[5]),
                       **({'ry': r4(d[6])} if d[6] else {}))
                  for d in RAMPS],
        # glTF frame: the Blender yaw of the outward normal IS the three.js ry
        'ladders': [dict(x=r4(l[0]), z=r4(-l[1]), ry=r4(l[5]), hw=r4(l[4]), y0=r4(l[2]), y1=r4(l[3]))
                    for l in LADDERS],
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
    LOG.append(f"{tag} size={tuple(round(s, 2) for s in size)} minZ={round(min(zs_), 3)} tris={tris} "
               f"mats={len(keep)} boxes={len(COLL)} ramps={len(RAMPS)} ladders={len(LADDERS)}")
    if EXPORT:
        json.dump(side, open(OUT_DIR + f"/{tag}.collision.json", 'w'), indent=1)
        export_glb([ob], OUT_DIR + f"/{tag}.glb")
        LOG.append("exported " + OUT_DIR + f"/{tag}.glb")
    else:
        # design renders (EEVEE in the GUI): sea, sun, a few 1.8 yd player proxies
        sc = bpy.context.scene
        sc.render.engine = 'BLENDER_EEVEE'
        world = sc.world or bpy.data.worlds.new("World")
        sc.world = world
        world.use_nodes = True
        bgn = world.node_tree.nodes.get("Background")
        bgn.inputs["Color"].default_value = (0.5, 0.64, 0.75, 1)
        bgn.inputs["Strength"].default_value = 1.0
        sd = bpy.data.lights.new("sun", 'SUN')
        sd.energy = 3.4
        sd.angle = math.radians(3)
        sun = bpy.data.objects.new("sun", sd)
        sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-40))
        sc.collection.objects.link(sun)
        wm = bpy.data.materials.new("_sea")
        wnt, wb = _nodes(wm)
        wb.inputs['Base Color'].default_value = (0.02, 0.17, 0.2, 1)
        wb.inputs['Roughness'].default_value = 0.06
        bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, Z_WL))
        sea = bpy.context.active_object
        sea.data.materials.append(wm)
        pm = bpy.data.materials.new("_proxy")
        pnt, pb = _nodes(pm)
        pb.inputs['Base Color'].default_value = (0.85, 0.12, 0.1, 1)
        for (px, py, pz) in ((2.0, 1.5, D_MAIN), (-2.5, -2.0, D_MAIN), (-9.6, 2.3, D_Q), (13.0, -1.0, D_F), (-15.0, 0.8, D_P), (-11.0, 1.9, D_Q + 1.7), (-12.5, 0.0, D_MAIN)):
            bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.4, depth=1.8, location=(px, py, pz + 0.9))
            bpy.context.active_object.data.materials.append(pm)
        cd = bpy.data.cameras.new("_cam")
        cd.lens = 30
        cd.clip_end = 3000
        cam = bpy.data.objects.new("_cam", cd)
        sc.collection.objects.link(cam)
        sc.camera = cam
        sc.render.resolution_x, sc.render.resolution_y = 1400, 900
        sc.render.image_settings.file_format = 'PNG'
        views = {
            'hero': ((52, -58, 30), (0, 0, 16)),
            'deck': ((-2, -16, 24), (1, 0, 10.5)),
            'stern': ((-44, -24, 16), (-12, 0, 11)),
            'bow': ((46, 22, 18), (10, 0, 12)),
            'side': ((0, -70, 14), (0, 0, 15)),
            'aft': ((-1.5, 7.5, 21), (-11.5, 1.0, 15.5)),
            'fwd': ((2.2, -3.6, 13.1), (10.0, 0.6, 11.3)),
            'landing': ((10.0, -16.0, 13.5), (3.8, -5.5, 9.8)),
            'nest': ((-7.0, -6.0, 26.0), (0.0, 0.0, 20.0)),
            'anchor': ((20.0, -9.0, 12.0), (14.4, -3.0, 10.0)),
            'inside': ((-3.0, -1.0, 11.6), (1.5, 6.0, 10.4)),
        }
        win = bpy.context.window_manager.windows[0] if bpy.context.window_manager.windows else None
        for name in [s for s in SHOTS.split(',') if s]:
            loc, tgt = views[name]
            cam.location = Vector(loc)
            cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = OUT_DIR + f"/galleon_{name}.png"
            if win:
                area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
                region = next(r for r in area.regions if r.type == 'WINDOW')
                with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
                    bpy.ops.render.render(write_still=True)
            else:
                bpy.ops.render.render(write_still=True)
            LOG.append("shot " + sc.render.filepath)
    LOG.append("done")
except Exception as e:
    LOG.append("ERROR " + repr(e))
    LOG.append(traceback.format_exc())
print("\n".join(str(x) for x in LOG))
result = "\n".join(str(x) for x in LOG)
