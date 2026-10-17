# Gourdlight Eve's harvest pieces: the keeper's market stall and the two
# street-dressing props that give the cities their harvest-festival mass (a corn
# shock and a dressed hay bale). Imported by model.py, which hands itself in as
# `m` for the shared helpers (materials, the carved pumpkin, the lantern, colour
# writers), so the whole kit stays one deterministic factory.
#
#   keeper_stall   Hester Gourdwick's booth. Origin = the keeper's standing spot
#                  (she stands INSIDE, behind the counter, facing Blender -Y, the
#                  way every carved face in the kit looks). A plank deck, a slatted
#                  counter piled with crates of gourds and a basket of sweets, a
#                  back wall of shelves, a striped orange and plum awning with a
#                  scalloped valance, two paper lanterns (one over each end of
#                  the counter, the middle open so her face reads), a painted
#                  pumpkin crest board (no lettering: the name plate is the game's own),
#                  corn shocks lashed to the front posts, hay bales and a crate
#                  stack outside. About 4.7 yd wide and 4.5 yd to the crest: well
#                  over twice a character's height.
#   corn_shock     a lashed bundle of dried corn stalks, about 2.2 yd tall.
#   hay_bale       a bound hay bale with a small lit pumpkin and a gourd on it.
#
# Determinism: no clock, no `random`; variety is m.h01 of a tag.

import math

import bmesh
from mathutils import Matrix, Vector

TAU = math.pi * 2.0

# Stall frame (yards). X across the booth, -Y toward the customers, Z up.
STALL_W = 4.6
FRONT_Y = -1.05
BACK_Y = 1.15
# The awning stands tall enough that the keeper behind the counter reads from a normal
# camera, her face clear of its valance and lanterns (owner note, 2026-10-17: raised 0.55).
FRONT_TOP = 3.1
BACK_TOP = 3.75
COUNTER_H = 1.05
DECK_TOP = 0.1
OVERHANG = 0.55
STRIPE_W = 0.384

ORANGE = (0.93, 0.4, 0.05)
PLUM = (0.2, 0.07, 0.19)
WOOD_LIGHT = (0.5, 0.33, 0.18)
WOOD_MID = (0.36, 0.22, 0.11)
WOOD_DARK = (0.22, 0.13, 0.07)
STRAW = (0.78, 0.64, 0.33)
STRAW_DARK = (0.46, 0.34, 0.15)


# ---------------------------------------------------------------------------
# small builders
# ---------------------------------------------------------------------------


def box(bm, center, size, rot_z=0.0, rot_x=0.0, rot_y=0.0):
    mat = (
        Matrix.Translation(center)
        @ Matrix.Rotation(rot_z, 4, "Z")
        @ Matrix.Rotation(rot_y, 4, "Y")
        @ Matrix.Rotation(rot_x, 4, "X")
        @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    )
    bmesh.ops.create_cube(bm, size=1.0, matrix=mat)


def part(m, name, bm, collection, mats, tint, bevel=0.0, smooth=False):
    """A finished, coloured part: `tint(mname, co, face_center, poly_index)`."""
    obj = m.new_object(name, bm, collection)
    m.set_materials(obj, mats)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        mod.limit_method = "ANGLE"
        m.apply_modifiers(obj)
    if smooth:
        m.shade_smooth(obj, 0.6)
    color_faces(m, obj, tint)
    return obj


def color_faces(m, obj, tint):
    me = obj.data
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    me.color_attributes.active_color_index = 0
    me.color_attributes.render_color_index = 0
    mats = [mt.name for mt in me.materials]
    data = []
    for poly in me.polygons:
        mname = mats[poly.material_index] if poly.material_index < len(mats) else mats[0]
        fc = poly.center
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            c = m.lin(tint(mname, co, fc, poly.index))
            data.extend((c[0], c[1], c[2], 1.0))
    col.data.foreach_set("color", data)


def wood_tint(m, tag, base=WOOD_MID, grain=0.12):
    def tint(mname, co, fc, pi):
        if mname == "Iron":
            return (0.08, 0.075, 0.07)
        k = 0.82 + 0.3 * m.h01(tag, "board", round(fc.x * 7.0), round(fc.y * 7.0))
        g = 1.0 + grain * math.sin(co.z * 31.0 + co.x * 17.0 + co.y * 13.0)
        return (base[0] * k * g, base[1] * k * g, base[2] * k * g)

    return tint


def transform_apply(m, obj, loc=None, rot=None, scale=None):
    import bpy

    if loc is not None:
        obj.location = loc
    if rot is not None:
        obj.rotation_euler = rot
    if scale is not None:
        obj.scale = scale
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)
    return obj


# ---------------------------------------------------------------------------
# harvest props (also used standalone in the streets)
# ---------------------------------------------------------------------------


def corn_shock_bm(tag, height=2.2, stalks=34, tie_z=0.95):
    """Dried corn stalks stood up in a cone and lashed at the waist: each stalk
    a thin flat blade (two faces so it reads from both sides), splayed at the
    foot, gathered at the tie, flared and drooping at the top."""
    bm = bmesh.new()
    for s in range(stalks):
        a = s / stalks * TAU + 0.4 * (0.5 - (s * 0.618) % 1.0)
        jit = (s * 0.7548) % 1.0
        foot_r = 0.32 + 0.12 * jit
        top_r = 0.34 + 0.22 * ((s * 0.3819) % 1.0)
        h = height * (0.82 + 0.22 * ((s * 0.5698) % 1.0))
        w = 0.035 + 0.015 * jit
        segs = 9
        prev = None
        for i in range(segs + 1):
            t = i / segs
            z = h * t
            if z <= tie_z:
                r = foot_r + (0.1 - foot_r) * (z / tie_z) ** 0.8
            else:
                u = (z - tie_z) / (h - tie_z)
                r = 0.1 + (top_r - 0.1) * u ** 1.3
            # the top third droops outward and down a little
            droop = max(0.0, t - 0.7) / 0.3
            z -= 0.18 * droop * droop
            r += 0.12 * droop * droop
            ax = math.cos(a) * r
            ay = math.sin(a) * r
            # the blade faces outward from the bundle's axis
            tx, ty = -math.sin(a), math.cos(a)
            ww = w * (1.0 - 0.6 * t)
            v0 = bm.verts.new((ax - tx * ww, ay - ty * ww, z))
            v1 = bm.verts.new((ax + tx * ww, ay + ty * ww, z))
            if prev:
                bm.faces.new((prev[0], prev[1], v1, v0))
            prev = (v0, v1)
        # a long dry leaf peeling off each stalk partway up
        if s % 2 == 0:
            la = a + 0.5
            z0 = tie_z + 0.25 + 0.5 * jit
            base = Vector((math.cos(a) * 0.14, math.sin(a) * 0.14, z0))
            prev = None
            for i in range(7):
                t = i / 6
                out = 0.55 * t
                p = base + Vector((math.cos(la) * out, math.sin(la) * out, 0.22 * t - 0.5 * t * t))
                tx, ty = -math.sin(la), math.cos(la)
                ww = 0.05 * math.sin(math.pi * min(0.95, t + 0.05))
                v0 = bm.verts.new((p.x - tx * ww, p.y - ty * ww, p.z))
                v1 = bm.verts.new((p.x + tx * ww, p.y + ty * ww, p.z))
                if prev:
                    bm.faces.new((prev[0], prev[1], v1, v0))
                prev = (v0, v1)
    return bm


def corn_shock(m, collection, name, tag, height=2.2):
    shock = part(
        m,
        name + "_stalks",
        corn_shock_bm(tag, height),
        collection,
        ["Straw"],
        lambda mn, co, fc, pi: m.mix(
            STRAW_DARK, STRAW, 0.35 + 0.55 * m.h01(tag, "stalk", pi // 9) + 0.1 * min(1.0, co.z / height)
        ),
    )
    # the lashing at the waist: two turns of orange cord and one of twine
    tbm = bmesh.new()
    for k, (z, r) in enumerate(((0.92, 0.135), (1.0, 0.125), (1.07, 0.12))):
        pts = [(math.cos(i / 16 * TAU) * r, math.sin(i / 16 * TAU) * r, z) for i in range(17)]
        m.tube_bm(tbm, pts, 0.018, 6)
    tie = part(
        m,
        name + "_tie",
        tbm,
        collection,
        ["Ribbon"],
        lambda mn, co, fc, pi: (0.95, 0.42, 0.05) if fc.z < 1.04 else (0.42, 0.32, 0.16),
    )
    # two ears of corn tucked into the bundle, husks peeled back
    ebm = bmesh.new()
    for k, (a, z) in enumerate(((0.6, 1.2), (3.1, 1.32))):
        c = Vector((math.cos(a) * 0.17, math.sin(a) * 0.17, z))
        mat = Matrix.Translation(c) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(-0.5, 4, "Y")
        bmesh.ops.create_uvsphere(ebm, u_segments=8, v_segments=8, radius=1.0,
                                  matrix=mat @ Matrix.Diagonal((0.05, 0.05, 0.14, 1)))
    ears = part(
        m,
        name + "_ears",
        ebm,
        collection,
        ["GourdSkin"],
        lambda mn, co, fc, pi: m.mix((0.7, 0.35, 0.08), (0.9, 0.62, 0.12), m.h01("ear", pi)),
        smooth=True,
    )
    return m.join([shock, tie, ears], name)


def hay_bale_bm(tag, size=(1.05, 0.55, 0.48)):
    """A bound bale: a subdivided box rounded at every edge (a rounded box, not
    a crate), its long faces bellied and roughened so it reads as packed straw."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((size[0], size[1], size[2], 1)))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=7, use_grid_fill=True)
    half = Vector((size[0] / 2, size[1] / 2, size[2] / 2))
    r = 0.09
    for v in bm.verts:
        p = v.co
        inner = Vector(tuple(max(-half[i] + r, min(half[i] - r, p[i])) for i in range(3)))
        d = p - inner
        q = inner + (d.normalized() * r if d.length > 1e-6 else Vector())
        nx, ny, nz = (q[i] / half[i] for i in range(3))
        belly = 0.025 * (1.0 - nx * nx) * (1.0 - nz * nz)
        rough = 0.01 * m_hs(tag, "v", round(p.x * 40), round(p.y * 40), round(p.z * 40))
        q.y += math.copysign(belly, q.y) + (rough if abs(ny) > 0.9 else 0.0)
        q.z += rough * 0.6 if abs(nz) > 0.9 else 0.0
        v.co = q
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, half.z))
    return bm


def straw_tint(m, tag, size):
    """Packed straw: long fibres running the bale's length, darker in the
    shade underneath, the cut ends paler and speckled."""
    hx = size[0] / 2

    def tint(mn, co, fc, pi):
        if mn != "Straw":
            return (0.3, 0.22, 0.12)
        # streaks at the mesh's own resolution (finer would alias into a checker)
        fibre = 0.5 + 0.5 * math.sin(co.y * 23.0 + co.z * 17.0 + 1.6 * math.sin(co.x * 4.0))
        base = m.mix(STRAW_DARK, STRAW, 0.4 + 0.3 * fibre + 0.3 * min(1.0, co.z / size[2]))
        if abs(fc.x) > hx - 0.05:
            speck = m.h01(tag, "end", round(co.y * 60), round(co.z * 60))
            base = m.mix(base, (0.86, 0.74, 0.44), 0.35 + 0.3 * speck)
        k = 0.97 + 0.03 * m.h01(tag, "f", pi)
        return (base[0] * k, base[1] * k, base[2] * k)

    return tint


_M = None


def m_hs(*parts):
    return _M.hs(*parts)


def hay_bale_part(m, collection, name, tag, size=(1.05, 0.55, 0.48)):
    bale = part(
        m,
        name + "_straw",
        hay_bale_bm(tag, size),
        collection,
        ["Straw"],
        straw_tint(m, tag, size),
        smooth=True,
    )
    # two twine bindings round the short way
    tbm = bmesh.new()
    # each a closed loop hugging the bale's rounded section, pulled into the straw
    hy, hz, r = size[1] / 2 + 0.012, size[2] / 2 + 0.006, 0.1
    corners = ((hy - r, hz - r, 0.0), (-(hy - r), hz - r, 0.5), (-(hy - r), -(hz - r), 1.0),
               (hy - r, -(hz - r), 1.5))
    for xb in (-size[0] * 0.28, size[0] * 0.28):
        pts = []
        for cy, cz, q in corners:
            for k in range(5):
                a = (q + k / 4 * 0.5) * math.pi
                pts.append((xb, cy + math.cos(a) * r, size[2] / 2 + cz + math.sin(a) * r))
        pts.append(pts[0])
        m.tube_bm(tbm, pts, 0.011, 5)
    twine = part(m, name + "_twine", tbm, collection, ["Ribbon"], lambda mn, co, fc, pi: (0.3, 0.22, 0.12))
    return m.join([bale, twine], name)


def build_hay_bale(m, collection):
    global _M
    _M = m
    """The street hay bale: a bale with a small carved pumpkin and a gourd on
    top and a few loose stalks of straw at its foot."""
    bale = hay_bale_part(m, collection, "hay_bale_base", "street-bale")
    pump = m.carved_pumpkin("hay_bale_pumpkin", "hay-pumpkin", collection, 0.22, 0.27, 8, "kind",
                            28, 16, m.PALETTE_DEEP, shell=0.035)
    transform_apply(m, pump, loc=(-0.2, 0.0, 0.48 + 0.135), rot=(0, 0, 0.25))
    gourd = m.plain_gourd("hay_bale_gourd", "hay-gourd", collection, 0.14, 0.17, 10, m.PALETTE_PALE,
                          (0.27, 0.06, 0.48 + 0.085))
    transform_apply(m, gourd, rot=(0.15, -0.1, 0.8))
    loose = bmesh.new()
    for i in range(14):
        a = m.h01("loose", i) * TAU
        r = 0.55 + 0.25 * m.h01("loose-r", i)
        cx, cy = math.cos(a) * r * 0.9, math.sin(a) * r * 0.55
        ln = 0.18 + 0.12 * m.h01("loose-l", i)
        d = (math.cos(a + 1.3) * ln, math.sin(a + 1.3) * ln)
        v0 = loose.verts.new((cx, cy, 0.01))
        v1 = loose.verts.new((cx + d[0], cy + d[1], 0.015))
        v2 = loose.verts.new((cx + d[0] + 0.012, cy + d[1] + 0.012, 0.015))
        v3 = loose.verts.new((cx + 0.012, cy + 0.012, 0.01))
        loose.faces.new((v0, v1, v2, v3))
    straw = part(m, "hay_bale_loose", loose, collection, ["Straw"], lambda mn, co, fc, pi: STRAW)
    return m.join([bale, pump, gourd, straw], "hay_bale")


# ---------------------------------------------------------------------------
# the stall
# ---------------------------------------------------------------------------


def awning_z(y):
    """The cloth's height at depth y (front edge low, back high)."""
    t = (y - FRONT_Y) / (BACK_Y - FRONT_Y)
    return FRONT_TOP + (BACK_TOP - FRONT_TOP) * t


def stripe_of(x):
    return int(math.floor((x + STALL_W / 2 + 0.2) / STRIPE_W)) % 2


def build_awning(m, collection):
    bm = bmesh.new()
    x0, x1 = -STALL_W / 2 - 0.2, STALL_W / 2 + 0.2
    y0, y1 = FRONT_Y - OVERHANG, BACK_Y + 0.08
    nx = int(round((x1 - x0) / STRIPE_W)) * 4
    ny = 14
    rafters = [-STALL_W / 2, -STALL_W / 6, STALL_W / 6, STALL_W / 2]
    grid = []
    for j in range(ny + 1):
        v = j / ny
        y = y0 + (y1 - y0) * v
        row = []
        for i in range(nx + 1):
            u = i / nx
            x = x0 + (x1 - x0) * u
            z = awning_z(y) + 0.05
            # sag between the rafters
            near = min(abs(x - r) for r in rafters)
            span = STALL_W / 3
            z -= 0.07 * math.sin(math.pi * min(1.0, near / (span / 2))) ** 1.5 * (1.0 if y > FRONT_Y - 0.05 else 0.6)
            # a soft wind ripple along the cloth
            z += 0.012 * math.sin(x * 5.3 + y * 2.1)
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    # the scalloped valance hanging off the front edge, one tongue per stripe
    front = grid[0]
    stripes = int(round((x1 - x0) / STRIPE_W))
    for s in range(stripes):
        xa = x0 + s * STRIPE_W
        xb = xa + STRIPE_W
        top_z = front[min(nx, s * 4)].co.z
        top_z2 = front[min(nx, (s + 1) * 4)].co.z
        pts_top = []
        n = 8
        for k in range(n + 1):
            t = k / n
            pts_top.append((xa + (xb - xa) * t, y0 - 0.005, top_z + (top_z2 - top_z) * t))
        pts_bot = []
        for k in range(n + 1):
            t = k / n
            x = xa + (xb - xa) * t
            drop = 0.2 + 0.12 * math.sin(math.pi * t)
            pts_bot.append((x, y0 - 0.03 - 0.03 * math.sin(math.pi * t), pts_top[k][2] - drop))
        vt = [bm.verts.new(p) for p in pts_top]
        vb = [bm.verts.new(p) for p in pts_bot]
        for k in range(n):
            bm.faces.new((vt[k], vt[k + 1], vb[k + 1], vb[k]))
    # side valances: a straight flap down each end of the cloth
    for side in (-1, 1):
        x = side * (STALL_W / 2 + 0.2)
        ny2 = 10
        prev = None
        for j in range(ny2 + 1):
            y = y0 + (y1 - y0) * j / ny2
            z = awning_z(y) + 0.05
            a = bm.verts.new((x + side * 0.004, y, z))
            b = bm.verts.new((x + side * 0.02, y, z - 0.24))
            if prev:
                bm.faces.new((prev[0], a, b, prev[1]) if side > 0 else (prev[1], b, a, prev[0]))
            prev = (a, b)

    def tint(mn, co, fc, pi):
        s = stripe_of(fc.x)
        side_flap = abs(fc.x) > STALL_W / 2 + 0.18
        base = ORANGE if (s == 0 or side_flap) else PLUM
        if side_flap:
            base = PLUM
        # the sun-faded top, the shaded folds near the rafters
        k = 0.9 + 0.12 * math.sin(fc.x * 5.3 + fc.y * 2.1) + 0.05 * m.h01("awn", pi)
        # a thin gold trim along the valance's lower edge
        if fc.y < FRONT_Y - OVERHANG - 0.004 and co.z < FRONT_TOP - 0.5:
            return (0.85, 0.62, 0.2)
        return (base[0] * k, base[1] * k, base[2] * k)

    return part(m, "stall_awning", bm, collection, ["Cloth"], tint, smooth=True)


def build_frame(m, collection):
    bm = bmesh.new()
    hw = STALL_W / 2
    post = 0.15
    # corner and middle posts, sunk into the deck
    for x in (-hw, -hw / 3, hw / 3, hw):
        for y, top in ((FRONT_Y, FRONT_TOP), (BACK_Y, BACK_TOP)):
            if abs(x) < hw - 0.01 and y == FRONT_Y:
                continue  # the front stays open between its corner posts
            box(bm, (x, y, (top - 0.4) / 2), (post, post, top + 0.4))
    # beams: front, back, and a rafter over each post pair, with knee braces
    box(bm, (0, FRONT_Y, FRONT_TOP - 0.07), (STALL_W + 0.3, 0.14, 0.16))
    box(bm, (0, BACK_Y, BACK_TOP - 0.07), (STALL_W + 0.3, 0.14, 0.16))
    # rafters under the whole cloth, overhang included, a hand below it
    run = BACK_Y - FRONT_Y
    rise = BACK_TOP - FRONT_TOP
    slope = math.atan2(rise, run)
    ya, yb = FRONT_Y - OVERHANG + 0.06, BACK_Y + 0.06
    length = (yb - ya) / math.cos(slope)
    cy = (ya + yb) / 2
    cz = awning_z(cy) - 0.07
    for x in (-hw, -hw / 3, hw / 3, hw):
        box(bm, (x, cy, cz), (0.1, length, 0.1), rot_x=slope)
    for x in (-hw, hw):
        for y, top, sgn in ((FRONT_Y, FRONT_TOP, 1), (BACK_Y, BACK_TOP, 1)):
            box(bm, (x - math.copysign(0.22, x), y, top - 0.36), (0.07, 0.07, 0.55),
                rot_y=math.copysign(0.75, x))
    # the plank deck the booth stands on, with a skirt that buries into the ground
    box(bm, (0, (FRONT_Y + BACK_Y) / 2, DECK_TOP - 0.25), (STALL_W + 0.25, BACK_Y - FRONT_Y + 0.3, 0.5))
    return part(m, "stall_frame", bm, collection, ["Wood"], wood_tint(m, "frame", WOOD_MID), bevel=0.018)


def build_planks(m, collection):
    """The counter front, its top, the side rails, the back wall and shelves:
    individual boards, each its own shade, gaps between them."""
    bm = bmesh.new()
    hw = STALL_W / 2
    cy = FRONT_Y + 0.25
    # counter front: vertical boards, a little ragged along their tops
    n = 17
    bw = (STALL_W - 0.3) / n
    for i in range(n):
        x = -hw + 0.15 + bw * (i + 0.5)
        h = COUNTER_H - 0.06 + 0.04 * m.hs("cf", i)
        box(bm, (x, FRONT_Y - 0.02, DECK_TOP + h / 2), (bw - 0.018, 0.05, h))
    # the counter top: two thick planks, overhanging the front
    for k, w in enumerate((0.3, 0.26)):
        y = FRONT_Y - 0.08 + k * 0.29
        box(bm, (0, y, DECK_TOP + COUNTER_H + 0.03), (STALL_W - 0.05, w - 0.015, 0.07))
    # counter ends, closing the counter's depth
    for x in (-hw + 0.17, hw - 0.17):
        box(bm, (x, cy + 0.1, DECK_TOP + COUNTER_H / 2), (0.06, 0.6, COUNTER_H))
    # side rails at knee and hip height
    for x in (-hw, hw):
        for z in (0.45, 0.9):
            box(bm, (x, (cy + 0.35 + BACK_Y) / 2, DECK_TOP + z), (0.06, BACK_Y - cy - 0.4, 0.09))
    # back wall: horizontal boards to shoulder height
    rows = 9
    for r in range(rows):
        z = DECK_TOP + 0.11 + r * 0.21
        box(bm, (0.03 * m.hs("bw", r), BACK_Y + 0.02, z), (STALL_W - 0.06, 0.05, 0.19))
    # two shelves on brackets
    for z in (1.05, 1.55):
        box(bm, (0, BACK_Y - 0.17, DECK_TOP + z), (STALL_W - 0.4, 0.3, 0.05))
        for x in (-hw + 0.5, 0, hw - 0.5):
            box(bm, (x, BACK_Y - 0.08, DECK_TOP + z - 0.1), (0.05, 0.12, 0.16))
    return part(m, "stall_planks", bm, collection, ["Wood"], wood_tint(m, "planks", WOOD_LIGHT, 0.16), bevel=0.01)


def build_crest(m, collection):
    """The crest board standing on the front beam: an arched, framed board with
    a painted carved pumpkin, two vines and a pair of leaves. No lettering."""
    parts = []
    bw, bh = 1.9, 0.86
    base_z = FRONT_TOP + 0.02
    y = FRONT_Y - 0.1
    # the board outline: a rectangle with an arched top
    pts = []
    for k in range(9):
        t = k / 8
        pts.append((-bw / 2 + bw * t, 0.0))
    arch = 18
    for k in range(arch + 1):
        a = math.pi * k / arch
        pts.append((math.cos(a) * bw / 2, bh * 0.62 + math.sin(a) * bh * 0.38))
    pts = list(dict.fromkeys(pts))
    pts = m.ensure_ccw([(p[0], p[1]) for p in pts])
    bm = bmesh.new()
    m.prism_from_polygon(bm, pts, y - 0.03, y + 0.03, 1.0, 1.0, base_z)
    # a raised frame round the board's edge
    rim = []
    for k in range(arch + 1):
        a = math.pi * k / arch
        rim.append((math.cos(a) * (bw / 2 - 0.03), y - 0.045, base_z + bh * 0.62 + math.sin(a) * (bh * 0.38 - 0.03)))
    m.tube_bm(bm, [(bw / 2 - 0.03, y - 0.045, base_z + 0.03)] + rim + [(-bw / 2 + 0.03, y - 0.045, base_z + 0.03)], 0.022, 6)
    m.tube_bm(bm, [(-bw / 2 + 0.03, y - 0.045, base_z + 0.03), (bw / 2 - 0.03, y - 0.045, base_z + 0.03)], 0.022, 6)
    # two stubs fixing it to the beam
    for x in (-0.55, 0.55):
        box(bm, (x, y + 0.04, base_z - 0.02), (0.08, 0.12, 0.12))
    board = part(m, "crest_board", bm, collection, ["Wood"],
                 lambda mn, co, fc, pi: (0.16, 0.09, 0.05) if fc.y < y - 0.035 else
                 tuple(c * (0.9 + 0.1 * math.sin(co.x * 23.0)) for c in (0.24, 0.12, 0.17)), bevel=0.008)
    parts.append(board)
    # the painted pumpkin: a lobed disc proud of the board
    cz = base_z + bh * 0.5
    py = y - 0.035
    lob = []
    for k in range(40):
        a = k / 40 * TAU
        r = 0.33 * (1.0 + 0.07 * abs(math.cos(a * 3.0)))
        lob.append((math.cos(a) * r * 1.12, math.sin(a) * r * 0.86))
    pbm = bmesh.new()
    m.prism_from_polygon(pbm, m.ensure_ccw(lob), py - 0.012, py, 1.0, 1.0, cz)
    pumpkin = part(m, "crest_pumpkin", pbm, collection, ["Paint"],
                   lambda mn, co, fc, pi: m.mix((0.68, 0.22, 0.02), (1.0, 0.5, 0.06),
                                                0.5 + 0.5 * abs(math.cos(math.atan2(co.z - cz, co.x) * 3.0))))
    parts.append(pumpkin)
    # its carved face, lit (the board's one glowing note at night)
    fbm = bmesh.new()
    for shape in m.face_shapes("grin"):
        m.prism_from_polygon(fbm, m.ensure_ccw(shape), py - 0.02, py - 0.011, 0.29, 0.38, cz - 0.01)
    face = part(m, "crest_face", fbm, collection, ["GourdGlow"], lambda mn, co, fc, pi: (1.0, 0.86, 0.5))
    parts.append(face)
    # stem and vines curling out to the board's shoulders, two leaves
    vbm = bmesh.new()
    m.tube_bm(vbm, [(0.0, py - 0.01, cz + 0.2), (0.02, py - 0.02, cz + 0.27), (0.07, py - 0.02, cz + 0.31)], 0.028, 6)
    for sgn in (-1, 1):
        pts = []
        for k in range(14):
            t = k / 13
            a = t * 4.0
            pts.append((sgn * (0.06 + 0.5 * t + 0.04 * math.sin(a * 3)), py - 0.016,
                        cz + 0.22 + 0.12 * math.sin(t * 3.0) - 0.05 * t))
        m.tube_bm(vbm, pts, 0.008, 5)
    for sgn in (-1, 1):
        lb = m.leaf_bm("crest-leaf-%d" % sgn, 0.09, (0, 0, 0), 0.0, 0.0)
        for v in lb.verts:
            v.co = Matrix.Translation((sgn * 0.3, py - 0.02, cz + 0.33)) @ Matrix.Rotation(-math.pi / 2, 4, "X") @ Matrix.Rotation(sgn * 0.9, 4, "Z") @ v.co
        vert_map = {}
        for v in lb.verts:
            vert_map[v] = vbm.verts.new(v.co)
        for f in lb.faces:
            vbm.faces.new([vert_map[v] for v in f.verts])
        lb.free()
    vines = part(m, "crest_vines", vbm, collection, ["Leaf"],
                 lambda mn, co, fc, pi: (0.3, 0.36, 0.1) if abs(co.x) < 0.12 else (0.42, 0.5, 0.14))
    parts.append(vines)
    # two little lanterns on the board's shoulders
    for x in (-bw / 2 - 0.05, bw / 2 + 0.05):
        lan = m.build_lantern(collection, "crest_lantern_%d" % (x > 0), 0.55, with_bracket=False, lean=True)
        transform_apply(m, lan, loc=(x, y, base_z + 0.25))
        parts.append(lan)
    return parts


def mini_gourd(m, collection, name, tag, radius, height, ribs, palette, offset):
    """A low-poly gourd for heaps (a dozen sit in one crate): a coarse ribbed
    body and a five-sided stem stub."""
    body = m.new_object(name, m.pumpkin_bm(tag, radius, height, ribs, 10, 7), collection)
    m.set_materials(body, ["GourdSkin"])
    m.shade_smooth(body, 1.2)
    sbm = bmesh.new()
    bmesh.ops.create_cone(sbm, cap_ends=True, segments=5, radius1=radius * 0.16, radius2=radius * 0.09,
                          depth=height * 0.35, matrix=Matrix.Translation((0, 0, height * 0.5)))
    stem = m.new_object(name + "_stem", sbm, collection)
    m.set_materials(stem, ["GourdStem"])
    obj = m.join([body, stem], name)
    m.color_pumpkin(obj, tag, radius, height, ribs, palette)
    obj.location = offset
    return obj


def gourd_pile(m, collection, tag, center, count, spread, z0, palettes):
    """A heap of small gourds of mixed colours, packed into a crate or basket."""
    out = []
    for i in range(count):
        a = m.h01(tag, "a", i) * TAU
        r = spread * math.sqrt(m.h01(tag, "r", i))
        layer = 0.0 if i < count * 0.6 else 0.09
        pal = palettes[int(m.h01(tag, "p", i) * len(palettes)) % len(palettes)]
        rad = 0.07 + 0.045 * m.h01(tag, "s", i)
        g = mini_gourd(m, collection, "%s_%d" % (tag, i), "%s-%d" % (tag, i), rad, rad * 1.15,
                       6 + (i % 3) * 2, pal,
                       (center[0] + math.cos(a) * r * 1.4, center[1] + math.sin(a) * r * 0.8,
                        z0 + rad * 0.55 + layer))
        transform_apply(m, g, rot=(m.hs(tag, "rx", i) * 0.4, m.hs(tag, "ry", i) * 0.4, a))
        out.append(g)
    return out


def crate(m, collection, name, center, size, rot=0.0):
    """A slatted crate: corner posts, three slats a side, a plank floor."""
    bm = bmesh.new()
    sx, sy, sz = size
    for cx in (-1, 1):
        for cy in (-1, 1):
            box(bm, (cx * (sx / 2 - 0.025), cy * (sy / 2 - 0.025), sz / 2), (0.05, 0.05, sz))
    for k in range(3):
        z = 0.06 + k * (sz - 0.1) / 2.4
        for cy in (-1, 1):
            box(bm, (0, cy * (sy / 2 - 0.01), z + 0.04), (sx, 0.02, 0.07))
        for cx in (-1, 1):
            box(bm, (cx * (sx / 2 - 0.01), 0, z + 0.04), (0.02, sy, 0.07))
    box(bm, (0, 0, 0.02), (sx - 0.04, sy - 0.04, 0.03))
    obj = part(m, name, bm, collection, ["Wood"], wood_tint(m, name, (0.55, 0.38, 0.2), 0.1), bevel=0.006)
    return transform_apply(m, obj, loc=center, rot=(0, 0, rot))


def sweets_basket(m, collection, center):
    """A round woven basket heaped with wrapped sweets."""
    parts = []
    bm = bmesh.new()
    rings = 7
    sides = 24
    prev = None
    for j in range(rings + 1):
        t = j / rings
        r = 0.2 + 0.07 * t
        z = 0.2 * t
        ring = [bm.verts.new((math.cos(k / sides * TAU) * r, math.sin(k / sides * TAU) * r, z)) for k in range(sides)]
        if prev:
            for k in range(sides):
                bm.faces.new((prev[k], prev[(k + 1) % sides], ring[(k + 1) % sides], ring[k]))
        else:
            bm.faces.new(list(reversed(ring)))
        prev = ring
    m.tube_bm(bm, [(math.cos(k / 24 * TAU) * 0.275, math.sin(k / 24 * TAU) * 0.275, 0.2) for k in range(25)], 0.018, 6)
    basket = part(m, "basket", bm, collection, ["Straw"],
                  lambda mn, co, fc, pi: m.mix((0.45, 0.3, 0.13), (0.62, 0.45, 0.2),
                                               0.5 + 0.5 * math.sin(math.atan2(co.y, co.x) * 24 + co.z * 60)))
    parts.append(transform_apply(m, basket, loc=center))
    sbm = bmesh.new()
    cols = [(0.9, 0.42, 0.05), (0.35, 0.12, 0.38), (0.95, 0.85, 0.3), (0.2, 0.42, 0.15), (0.85, 0.2, 0.12)]
    count = 22
    for i in range(count):
        a = m.h01("sw", "a", i) * TAU
        r = 0.2 * math.sqrt(m.h01("sw", "r", i))
        z = 0.2 + 0.05 * (1.0 - (r / 0.2) ** 2) + 0.03 * m.h01("sw", "z", i)
        mat = (Matrix.Translation((center[0] + math.cos(a) * r, center[1] + math.sin(a) * r, center[2] + z))
               @ Matrix.Rotation(m.h01("sw", "t", i) * TAU, 4, "Z"))
        bmesh.ops.create_uvsphere(sbm, u_segments=5, v_segments=4, radius=1.0,
                                  matrix=mat @ Matrix.Diagonal((0.035, 0.026, 0.026, 1)))
        for sgn in (-1, 1):
            bmesh.ops.create_cone(sbm, cap_ends=True, segments=4, radius1=0.004, radius2=0.022, depth=0.03,
                                  matrix=mat @ Matrix.Translation((sgn * 0.045, 0, 0)) @ Matrix.Rotation(sgn * math.pi / 2, 4, "Y"))
    sweets = part(m, "sweets", sbm, collection, ["Ribbon"],
                  lambda mn, co, fc, pi: cols[int(m.h01("swc", round(fc.x * 30), round(fc.y * 30)) * len(cols)) % len(cols)])
    parts.append(sweets)
    return parts


def candy_jars(m, collection):
    """Glass jars of sweets along the upper shelf."""
    out = []
    bm = bmesh.new()
    for i, x in enumerate((-1.6, -1.2, -0.8, 0.85, 1.25)):
        z0 = DECK_TOP + 1.55 + 0.025
        h = 0.22
        bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.075, radius2=0.075, depth=h,
                              matrix=Matrix.Translation((x, BACK_Y - 0.17, z0 + h / 2)))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.05, radius2=0.05, depth=0.04,
                              matrix=Matrix.Translation((x, BACK_Y - 0.17, z0 + h + 0.02)))
    cols = [(0.85, 0.35, 0.05), (0.42, 0.12, 0.42), (0.9, 0.75, 0.2), (0.75, 0.15, 0.1), (0.3, 0.5, 0.15)]
    jars = part(m, "jars", bm, collection, ["Ribbon"],
                lambda mn, co, fc, pi: (0.25, 0.16, 0.08) if fc.z > DECK_TOP + 1.575 + 0.22
                else cols[int((fc.x + 2.0) * 2.5) % len(cols)])
    out.append(jars)
    return out


def build_stall(m, collection):
    global _M
    _M = m
    parts = [build_frame(m, collection), build_planks(m, collection), build_awning(m, collection)]
    parts += build_crest(m, collection)
    # paper lanterns hung under the overhang on cords
    cbm = bmesh.new()
    # two, one over each end of the counter: the middle stays open, so nothing hangs
    # in front of the keeper's face
    for i, x in enumerate((-1.75, 1.75)):
        lan = m.build_lantern(collection, "stall_lantern_%d" % i, 1.35, with_bracket=False, lean=True)
        cz = FRONT_TOP - 0.55
        transform_apply(m, lan, loc=(x, FRONT_Y - 0.3, cz))
        parts.append(lan)
        top = FRONT_TOP - 0.02 - (0.3 * 0.42)
        m.tube_bm(cbm, [(x, FRONT_Y - 0.3, cz + 0.32), (x, FRONT_Y - 0.3, awning_z(FRONT_Y - 0.3) - 0.02)], 0.007, 4)
    # a leaf swag along the front beam, dipping between the posts
    for k in range(34):
        t = k / 33
        x = -STALL_W / 2 + STALL_W * t
        sag = 0.16 * math.sin(math.pi * ((t * 3.0) % 1.0))
        lb = m.leaf_bm("swag-%d" % k, 0.1, (0, 0, 0), m.h01("swag", k) * TAU, 0.02)
        lb_mat = Matrix.Translation((x, FRONT_Y - 0.09, FRONT_TOP - 0.16 - sag)) @ Matrix.Rotation(-1.2, 4, "X")
        for v in lb.verts:
            v.co = lb_mat @ v.co
        vmap = {v: cbm.verts.new(v.co) for v in lb.verts}
        for f in lb.faces:
            cbm.faces.new([vmap[v] for v in f.verts])
        lb.free()
    palette = [(0.78, 0.26, 0.04), (0.9, 0.55, 0.06), (0.55, 0.12, 0.05), (0.64, 0.46, 0.1)]
    swag = part(m, "stall_swag", cbm, collection, ["Leaf"],
                lambda mn, co, fc, pi: (0.12, 0.1, 0.08) if mn == "Iron" else palette[int(m.h01("swag-c", pi // 20) * 4) % 4])
    parts.append(swag)
    # the counter's wares: two crates of gourds, the sweets basket, a lit pumpkin
    top = DECK_TOP + COUNTER_H + 0.065
    pal = [m.PALETTE_ORANGE, m.PALETTE_PALE, m.PALETTE_GREEN, m.PALETTE_DEEP]
    for i, x in enumerate((-1.55, 1.2)):
        parts.append(crate(m, collection, "counter_crate_%d" % i, (x, FRONT_Y + 0.08, top), (0.62, 0.42, 0.24),
                           rot=0.08 * (1 if i else -1)))
        parts += gourd_pile(m, collection, "counter-gourds-%d" % i, (x, FRONT_Y + 0.08), 8, 0.17, top + 0.04, pal)
    parts += sweets_basket(m, collection, (-0.35, FRONT_Y + 0.1, top))
    lit = m.carved_pumpkin("counter_pumpkin", "counter-pumpkin", collection, 0.2, 0.25, 8, "grin", 28, 16,
                           m.PALETTE_ORANGE, shell=0.03)
    transform_apply(m, lit, loc=(0.42, FRONT_Y + 0.05, top + 0.125), rot=(0, 0, -0.2))
    parts.append(lit)
    # the shelves: jars of sweets above, gourds and a small pumpkin below
    parts += candy_jars(m, collection)
    parts += gourd_pile(m, collection, "shelf-gourds", (-0.9, BACK_Y - 0.17), 6, 0.12, DECK_TOP + 1.075, pal)
    parts += gourd_pile(m, collection, "shelf-gourds-b", (1.2, BACK_Y - 0.17), 5, 0.1, DECK_TOP + 1.075, pal)
    # outside: corn shocks lashed to the front posts, hay bales stacked left with
    # a big lit pumpkin on top, a crate stack with pumpkins right
    for i, x in enumerate((-STALL_W / 2 - 0.1, STALL_W / 2 + 0.1)):
        shock = corn_shock(m, collection, "stall_shock_%d" % i, "stall-shock-%d" % i, 2.35)
        transform_apply(m, shock, loc=(x, FRONT_Y - 0.28, 0.0), rot=(0, 0, 0.7 * i))
        parts.append(shock)
    b1 = hay_bale_part(m, collection, "stall_bale_a", "stall-bale-a")
    parts.append(transform_apply(m, b1, loc=(-STALL_W / 2 - 0.85, -0.2, 0.0), rot=(0, 0, math.pi / 2 + 0.1)))
    b2 = hay_bale_part(m, collection, "stall_bale_b", "stall-bale-b")
    parts.append(transform_apply(m, b2, loc=(-STALL_W / 2 - 0.85, 0.75, 0.0), rot=(0, 0, math.pi / 2 - 0.06)))
    b3 = hay_bale_part(m, collection, "stall_bale_c", "stall-bale-c")
    parts.append(transform_apply(m, b3, loc=(-STALL_W / 2 - 0.8, 0.25, 0.48), rot=(0, 0, math.pi / 2 + 0.03)))
    big = m.carved_pumpkin("stall_big_pumpkin", "stall-big", collection, 0.34, 0.44, 10, "grin", 36, 20,
                           m.PALETTE_ORANGE)
    transform_apply(m, big, loc=(-STALL_W / 2 - 0.78, 0.2, 0.96 + 0.22), rot=(0, 0, -0.35))
    parts.append(big)
    small = m.plain_gourd("stall_bale_gourd", "stall-bale-gourd", collection, 0.16, 0.2, 10, m.PALETTE_PALE,
                          (-STALL_W / 2 - 0.7, 0.75, 0.96 - 0.48 + 0.1 + 0.0))
    parts.append(small)
    parts.append(crate(m, collection, "side_crate_a", (STALL_W / 2 + 0.75, -0.25, 0.0), (0.7, 0.5, 0.42), rot=0.12))
    parts.append(crate(m, collection, "side_crate_b", (STALL_W / 2 + 0.7, 0.45, 0.0), (0.7, 0.5, 0.42), rot=-0.05))
    parts.append(crate(m, collection, "side_crate_c", (STALL_W / 2 + 0.72, 0.1, 0.42), (0.7, 0.5, 0.42), rot=0.04))
    parts += gourd_pile(m, collection, "side-crate-gourds", (STALL_W / 2 + 0.72, 0.1), 8, 0.18, 0.84, pal)
    for i, (x, y, r) in enumerate(((STALL_W / 2 + 0.55, -0.85, 0.3), (STALL_W / 2 + 1.05, -0.7, 0.22))):
        g = m.plain_gourd("side_pumpkin_%d" % i, "side-pumpkin-%d" % i, collection, r, r * 1.2, 10,
                          m.PALETTE_ORANGE if i == 0 else m.PALETTE_DEEP, (x, y, r * 0.6), segs=24, rings=12)
        parts.append(g)
    obj = m.join(parts, "keeper_stall")
    return obj
