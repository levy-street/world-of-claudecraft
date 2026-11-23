# Gourdlight Eve's props: a deterministic Blender factory (texture-free, vertex
# coloured, like the boulder kit and the muster camp kit).
#
# Two GLBs come out of it:
#
#   gourdlight_decor.glb   the city dressing, one named mesh node per piece:
#     pumpkin_lit          a big carved pumpkin, hollow, its face cut right through
#                          the rind and lit from inside (the glow materials)
#     pumpkin_small        a smaller carved pumpkin with a different face
#     gourd                an uncarved pair of harvest gourds with a vine and a leaf
#     lantern              an orange paper lantern on an iron bracket (origin = the
#                          bracket's root against its lamp post)
#     garland_pole         a festival pole: a turned post wound with a ribbon, a
#                          crossbar and a finial (origin = its foot)
#     garland_leaf         one cluster of autumn leaves for the strung garland
#     garland_bead         one small paper lantern bead for the strung garland
#     road_lantern         a small carved pumpkin hung from a short crook post, for a
#                          road's verge between the towns (origin = the post's foot)
#   gourdlight_pumpkin_head.glb  the wearable head: hollow, a neck opening, the
#     carved face lit from inside (origin = the centre of the pumpkin)
#
# Materials (names are the runtime contract, src/render/seasonal_decor_assets.ts):
#   GourdSkin, GourdStem, Wood, Iron, Leaf, Ribbon  vertex-coloured, unlit by us
#   GourdFlesh, GourdInner, GourdGlow, LanternPaper emissive: the renderer drives
#                          their glow (dim by day, bright at night, a candle flicker)
#
# Frame: Blender Z-up, which the glTF exporter turns into +Y up. A carved face
# looks down Blender -Y, which is the glTF/three +Z a character faces.
#
#   blender --background --factory-startup --python \
#     scripts/assets/gourdlight_eve/model.py -- --out <dir> [--preview <dir>]
#
# Determinism: no clock, no `random`; every variation is a sha256 of a tag.

import hashlib
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stall  # noqa: E402  (the keeper's stall and the harvest props)

this = sys.modules[__name__]

TAU = math.pi * 2.0


def h01(*parts):
    text = "|".join(str(p) for p in parts)
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16) / float(1 << 48)


def hs(*parts):
    return h01(*parts) * 2.0 - 1.0


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c0, c1, t):
    return tuple(lerp(c0[i], c1[i], t) for i in range(3))


def lin(c):
    """An authored sRGB colour to the LINEAR value a vertex colour stores
    (glTF COLOR_0 and three both read vertex colours as linear)."""
    return tuple(ch ** 2.2 if ch > 0 else 0.0 for ch in c[:3])


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------

MATERIAL_DEFS = {
    "GourdSkin": {"rough": 0.46, "metal": 0.0},
    # a carved pumpkin's rind: the candle inside shows through it faintly at
    # night (the renderer drives it, tinted by the vertex colour)
    "GourdLitSkin": {"rough": 0.46, "metal": 0.0, "emit": (1.0, 0.45, 0.12)},
    "GourdStem": {"rough": 0.82, "metal": 0.0},
    "GourdFlesh": {"rough": 0.72, "metal": 0.0, "emit": (1.0, 0.52, 0.12)},
    "GourdInner": {"rough": 0.85, "metal": 0.0, "emit": (1.0, 0.42, 0.06)},
    "GourdGlow": {"rough": 0.5, "metal": 0.0, "emit": (1.0, 0.78, 0.38)},
    "LanternPaper": {"rough": 0.78, "metal": 0.0, "emit": (1.0, 0.46, 0.1)},
    "Wood": {"rough": 0.86, "metal": 0.0},
    "Iron": {"rough": 0.58, "metal": 0.55},
    "Leaf": {"rough": 0.7, "metal": 0.0},
    "Ribbon": {"rough": 0.64, "metal": 0.0},
    "Cloth": {"rough": 0.9, "metal": 0.0},
    "Straw": {"rough": 0.95, "metal": 0.0},
    "Paint": {"rough": 0.7, "metal": 0.0},
}


def material(name):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    spec = MATERIAL_DEFS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = spec["metal"]
    bsdf.inputs["Roughness"].default_value = spec["rough"]
    if "emit" in spec:
        e = spec["emit"]
        bsdf.inputs["Emission Color"].default_value = (e[0], e[1], e[2], 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return mat


# ---------------------------------------------------------------------------
# mesh helpers
# ---------------------------------------------------------------------------


def new_object(name, bm, collection):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    collection.objects.link(obj)
    return obj


def set_materials(obj, names):
    for n in names:
        obj.data.materials.append(material(n))


def apply_modifiers(obj):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = name
    out.data.name = name
    return out


def shade_smooth(obj, angle=0.7):
    for p in obj.data.polygons:
        p.use_smooth = True
    if hasattr(obj.data, "set_sharp_from_angle"):
        obj.data.set_sharp_from_angle(angle=angle)


# ---------------------------------------------------------------------------
# the pumpkin body
# ---------------------------------------------------------------------------


def rib_profile(phi, ribs):
    """1 on a lobe's crown, 0 in the groove between two lobes."""
    return abs(math.cos(ribs * 0.5 * phi))


def pumpkin_bm(tag, radius, height, ribs, segs, rings, squash_top=0.24, tilt=True):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    tilt = hs(tag, "tilt") * 0.05 if tilt else 0.0
    for v in bm.verts:
        x, y, z = v.co
        phi = math.atan2(y, x)
        lobe = rib_profile(phi, ribs)
        groove = (1.0 - lobe) ** 2.4
        # lobes swell a touch unevenly, grooves pinch in
        swell = 1.0 + 0.035 * hs(tag, "lobe", int((phi + math.pi) / TAU * ribs))
        rs = (1.0 - 0.11 * groove) * swell
        # flatter belly near the ground, a little shoulder near the top
        rs *= 1.0 + 0.06 * math.sin(math.pi * (z * 0.5 + 0.5)) - 0.02 * z
        x *= rs
        y *= rs
        d = math.hypot(x, y)
        # the stem well at the top, the blossom dimple underneath
        if z > 0:
            z -= squash_top * math.exp(-((d / 0.32) ** 2)) * z
        else:
            z += 0.12 * math.exp(-((d / 0.24) ** 2)) * (-z)
        z += tilt * x
        v.co = Vector((x * radius, y * radius, z * height * 0.5))
    return bm


def color_pumpkin(obj, tag, radius, height, ribs, palette, skin_index=0):
    """Vertex colours: deep grooves, bright lobe crowns, a green stem ring, a
    sun-faded yellow belly, the carved flesh pale, the inside of the rind lit."""
    me = obj.data
    col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    me.color_attributes.active_color_index = 0
    me.color_attributes.render_color_index = 0
    mats = [m.name for m in me.materials]
    data = []
    for poly in me.polygons:
        mname = mats[poly.material_index] if poly.material_index < len(mats) else "GourdSkin"
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            co = me.vertices[vi].co
            if mname in ("GourdSkin", "GourdLitSkin"):
                phi = math.atan2(co.y, co.x)
                lobe = rib_profile(phi, ribs)
                zn = co.z / (height * 0.5)
                base = mix(palette["groove"], palette["crown"], smooth(lobe * 1.15))
                # the belly the sun never reached is paler and yellower
                base = mix(base, palette["belly"], smooth(-zn * 1.4 - 0.2) * 0.55)
                # green collar round the stem well
                d = math.hypot(co.x, co.y) / radius
                base = mix(base, palette["collar"], smooth((zn - 0.55) * 4.0) * smooth(0.6 - d) * 0.8)
                # fine streaks along the ribs and a few blemishes
                streak = 0.06 * math.sin(phi * ribs * 3.0 + zn * 7.0 + h01(tag, "s") * 6.0)
                fleck = 0.08 if h01(tag, "fleck", vi) > 0.985 else 0.0
                k = 1.0 + streak - fleck
                c = (base[0] * k, base[1] * k, base[2] * k)
            elif mname == "GourdFlesh":
                c = (1.0, 0.8, 0.42)
            elif mname == "GourdInner":
                c = (1.0, 0.62, 0.22)
            elif mname == "GourdGlow":
                c = (1.0, 0.92, 0.66)
            elif mname == "GourdStem":
                t = smooth((co.z - height * 0.36) / (height * 0.36))
                c = mix(palette["stem_low"], palette["stem_high"], t)
                if poly.normal.z > 0.8 and co.z > height * 0.5:
                    c = (0.72, 0.62, 0.42)  # the cut end, pale and dry
                c = tuple(ch * (0.85 + 0.25 * h01(tag, "stem", vi)) for ch in c)
            elif mname == "Leaf":
                c = palette.get("leaf", (0.35, 0.42, 0.12))
            else:
                c = (0.5, 0.5, 0.5)
            c = lin(c)
            data.extend((c[0], c[1], c[2], 1.0))
    col.data.foreach_set("color", data)


def stem_bm(tag, radius, height, length, thick):
    """A gnarled, curving stem: stacked rings swept along a bent spine, ribbed."""
    bm = bmesh.new()
    rings = 12
    sides = 10
    bend = 0.55 + 0.35 * h01(tag, "bend")
    yaw = TAU * h01(tag, "yaw")
    twist = hs(tag, "twist") * 0.8
    prev = None
    first = None
    top_z = height * 0.5 * (1.0 - 0.22) - 0.03
    for i in range(rings + 1):
        t = i / rings
        # the spine leans over and curls back a little at its tip
        lean = (math.sin(t * 1.9) * bend - 0.25 * t * t) * length * 0.55
        cx = math.cos(yaw) * lean
        cy = math.sin(yaw) * lean
        cz = top_z + math.sin(t * 1.3) / math.sin(1.3) * length
        flare = 1.0 + 0.9 * (1.0 - smooth(t * 3.0))
        r = thick * (1.0 - 0.35 * t) * flare
        ring = []
        for k in range(sides):
            a = k / sides * TAU + t * twist
            rr = r * (1.0 + 0.16 * math.cos(a * 5.0))
            ring.append(bm.verts.new((cx + math.cos(a) * rr, cy + math.sin(a) * rr, cz)))
        if prev:
            for k in range(sides):
                bm.faces.new((prev[k], prev[(k + 1) % sides], ring[(k + 1) % sides], ring[k]))
        else:
            first = ring
        prev = ring
    bm.faces.new(list(reversed(first)))
    bm.faces.new(prev)
    return bm


def prism_from_polygon(bm, pts, y0, y1, scale_x, scale_z, z_off):
    """Extrude one 2D polygon (x, z) into a prism spanning y0..y1."""
    front = [bm.verts.new((p[0] * scale_x, y0, p[1] * scale_z + z_off)) for p in pts]
    back = [bm.verts.new((p[0] * scale_x, y1, p[1] * scale_z + z_off)) for p in pts]
    n = len(pts)
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[j], front[i], back[i], back[j]))


def face_shapes(style):
    """The carving, in a unit face frame (x across, z up, origin at the face centre)."""
    shapes = []
    if style == "grin":
        shapes.append([(-0.46, 0.14), (-0.12, 0.14), (-0.3, 0.46)])  # left eye
        shapes.append([(0.12, 0.14), (0.46, 0.14), (0.3, 0.46)])  # right eye
        shapes.append([(-0.08, -0.02), (0.08, -0.02), (0.0, 0.12)])  # nose
        mouth = []
        n = 14
        for i in range(n + 1):
            t = i / n
            x = lerp(-0.6, 0.6, t)
            top = -0.16 - 0.1 * (1.0 - (2 * t - 1) ** 2)
            if i in (4, 10):
                top += 0.13  # two teeth hanging down from the lip
            mouth.append((x, top))
        for i in range(n, -1, -1):
            t = i / n
            x = lerp(-0.6, 0.6, t)
            bot = -0.2 - 0.32 * (1.0 - (2 * t - 1) ** 2)
            if i == 7:
                bot += 0.14  # one tooth standing up
            mouth.append((x, bot))
        shapes.append(mouth)
    elif style == "fang":
        shapes.append([(-0.52, 0.42), (-0.1, 0.17), (-0.44, 0.1)])  # angry slanted eyes
        shapes.append([(0.52, 0.42), (0.44, 0.1), (0.1, 0.17)])
        mouth = []
        n = 12
        for i in range(n + 1):
            t = i / n
            x = lerp(-0.55, 0.55, t)
            top = -0.1 - 0.05 * (1.0 - (2 * t - 1) ** 2)
            if i % 3 == 1:
                top -= 0.12  # a row of fangs
            mouth.append((x, top))
        for i in range(n, -1, -1):
            t = i / n
            x = lerp(-0.55, 0.55, t)
            bot = -0.18 - 0.26 * (1.0 - (2 * t - 1) ** 2)
            if i % 3 == 2:
                bot += 0.1
            mouth.append((x, bot))
        shapes.append(mouth)
    else:  # "kind": round eyes and a gentle smile, the small pumpkin
        for sx in (-1, 1):
            eye = []
            for k in range(10):
                a = k / 10 * TAU
                eye.append((sx * 0.27 + math.cos(a) * 0.12, 0.26 + math.sin(a) * 0.14))
            shapes.append(list(reversed(eye)) if sx < 0 else eye)
        smile = []
        n = 12
        for i in range(n + 1):
            t = i / n
            x = lerp(-0.45, 0.45, t)
            smile.append((x, -0.1 - 0.12 * (1.0 - (2 * t - 1) ** 2)))
        for i in range(n, -1, -1):
            t = i / n
            x = lerp(-0.4, 0.4, t)
            smile.append((x, -0.15 - 0.27 * (1.0 - (2 * t - 1) ** 2)))
        shapes.append(smile)
    return shapes


def ensure_ccw(pts):
    area = 0.0
    for i in range(len(pts)):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % len(pts)]
        area += x0 * z1 - x1 * z0
    return pts if area > 0 else list(reversed(pts))


def carved_pumpkin(name, tag, collection, radius, height, ribs, style, segs, rings,
                   palette, neck_hole=0.0, shell=0.05, glow_r=0.3, face_lift=0.06, tilt=True,
                   face_scale=(0.92, 0.62)):
    body = new_object(name, pumpkin_bm(tag, radius, height, ribs, segs, rings, tilt=tilt), collection)
    set_materials(body, ["GourdLitSkin", "GourdInner", "GourdFlesh"])
    shade_smooth(body, 1.2)
    sol = body.modifiers.new("shell", "SOLIDIFY")
    sol.thickness = shell
    sol.offset = -1.0
    sol.material_offset = 1
    sol.material_offset_rim = 2
    sol.use_even_offset = True
    apply_modifiers(body)
    # the cutters: the face, projected straight back through the front of the rind
    cbm = bmesh.new()
    for pts in face_shapes(style):
        prism_from_polygon(cbm, ensure_ccw(pts), -radius * 1.6, -radius * 0.15,
                           radius * face_scale[0], height * face_scale[1], height * face_lift)
    if neck_hole > 0:
        bmesh.ops.create_cone(cbm, cap_ends=True, segments=24, radius1=neck_hole,
                              radius2=neck_hole, depth=height * 0.8,
                              matrix=Matrix.Translation((0, 0, -height * 0.5)))
    cutter = new_object(name + "_cut", cbm, collection)
    set_materials(cutter, ["GourdFlesh"])
    boolean = body.modifiers.new("carve", "BOOLEAN")
    boolean.operation = "DIFFERENCE"
    boolean.solver = "EXACT"
    boolean.object = cutter
    before = len(body.data.polygons)
    apply_modifiers(body)
    bpy.data.objects.remove(cutter, do_unlink=True)
    if len(body.data.polygons) < before * 0.8:
        raise RuntimeError("%s: the carve lost the rind (%d -> %d faces)" % (name, before, len(body.data.polygons)))
    # the candle inside: a soft glowing core low in the cavity
    gbm = bmesh.new()
    bmesh.ops.create_icosphere(gbm, subdivisions=2, radius=radius * glow_r,
                               matrix=Matrix.Translation((0, radius * 0.05, -height * 0.12)))
    glow = new_object(name + "_glow", gbm, collection)
    set_materials(glow, ["GourdGlow"])
    lid = lid_seam(name, tag, body, collection, radius, height)
    stem = new_object(name + "_stem", stem_bm(tag, radius, height, height * 0.36, radius * 0.12), collection)
    set_materials(stem, ["GourdStem"])
    shade_smooth(stem, 1.0)
    obj = join([body, glow, lid, stem], name)
    color_pumpkin(obj, tag, radius, height, ribs, palette)
    return obj


def lid_seam(name, tag, body, collection, radius, height):
    """The lid's cut round the stem, a zigzag line of candlelight showing
    through it: what keeps a carved pumpkin reading as LIT from behind and from
    above, where the face cannot be seen. A thin ribbon laid on the rind,
    found by casting down onto the carved body."""
    from mathutils.bvhtree import BVHTree

    bpy.context.view_layer.update()
    bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    n = 36
    pts = []
    for k in range(n + 1):
        a = k / n * TAU + h01(tag, "lid") * TAU
        zig = 1.0 + (0.13 if k % 2 else -0.13)
        d = radius * 0.4 * zig
        hit = bvh.ray_cast(Vector((math.cos(a) * d, math.sin(a) * d, height)), Vector((0, 0, -1)))
        if hit[0] is None:
            continue
        pts.append((hit[0], hit[1]))
    bm = bmesh.new()
    prev = None
    w = radius * 0.035
    for i, (p, nrm) in enumerate(pts):
        q = pts[min(len(pts) - 1, i + 1)][0] - pts[max(0, i - 1)][0]
        side = nrm.cross(q).normalized() * w
        base = p + nrm * 0.004
        v0 = bm.verts.new(base - side)
        v1 = bm.verts.new(base + side)
        if prev:
            bm.faces.new((prev[0], prev[1], v1, v0))
        prev = (v0, v1)
    lid = new_object(name + "_lid", bm, collection)
    set_materials(lid, ["GourdGlow"])
    return lid


def plain_gourd(name, tag, collection, radius, height, ribs, palette, offset, segs=32, rings=16):
    body = new_object(name, pumpkin_bm(tag, radius, height, ribs, segs, rings), collection)
    set_materials(body, ["GourdSkin"])
    shade_smooth(body, 1.2)
    stem = new_object(name + "_stem", stem_bm(tag, radius, height, height * 0.3, radius * 0.12), collection)
    set_materials(stem, ["GourdStem"])
    obj = join([body, stem], name)
    color_pumpkin(obj, tag, radius, height, ribs, palette)
    obj.location = offset
    return obj


PALETTE_ORANGE = {
    "groove": (0.56, 0.2, 0.02),
    "crown": (1.0, 0.47, 0.04),
    "belly": (0.98, 0.66, 0.2),
    "collar": (0.36, 0.38, 0.08),
    "stem_low": (0.3, 0.33, 0.1),
    "stem_high": (0.42, 0.32, 0.18),
}
PALETTE_DEEP = {
    "groove": (0.34, 0.08, 0.01),
    "crown": (0.86, 0.32, 0.03),
    "belly": (0.94, 0.55, 0.14),
    "collar": (0.3, 0.32, 0.06),
    "stem_low": (0.26, 0.3, 0.09),
    "stem_high": (0.38, 0.29, 0.16),
}
PALETTE_PALE = {
    "groove": (0.62, 0.48, 0.3),
    "crown": (0.95, 0.88, 0.7),
    "belly": (0.98, 0.93, 0.78),
    "collar": (0.42, 0.45, 0.24),
    "stem_low": (0.3, 0.34, 0.14),
    "stem_high": (0.45, 0.38, 0.22),
}
PALETTE_GREEN = {
    "groove": (0.12, 0.22, 0.06),
    "crown": (0.42, 0.52, 0.18),
    "belly": (0.72, 0.62, 0.22),
    "collar": (0.2, 0.28, 0.06),
    "stem_low": (0.24, 0.3, 0.1),
    "stem_high": (0.38, 0.32, 0.18),
}


def leaf_bm(tag, size, origin, yaw, droop):
    """A five-lobed autumn leaf: a fan of points, a midrib crease, a curl."""
    bm = bmesh.new()
    pts = []
    n = 20
    for i in range(n + 1):
        t = i / n
        a = lerp(-1.25, 1.25, t)
        lobe = 0.62 + 0.38 * abs(math.cos(a * 2.5))
        r = size * lobe
        pts.append((math.sin(a) * r, math.cos(a) * r))
    center = bm.verts.new((0, 0, 0))
    ring = []
    for (x, y) in pts:
        bend = -droop * (y / size) ** 2 - 0.15 * size * abs(x / size)
        ring.append(bm.verts.new((x, y, bend)))
    for i in range(len(ring) - 1):
        bm.faces.new((center, ring[i], ring[i + 1]))
    # second side so it reads from below too
    rot = Matrix.Rotation(yaw, 4, "Z")
    for v in bm.verts:
        v.co = rot @ v.co + Vector(origin)
    return bm


def color_flat(obj, rgb_for):
    me = obj.data
    col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    me.color_attributes.active_color_index = 0
    me.color_attributes.render_color_index = 0
    mats = [m.name for m in me.materials]
    data = []
    for poly in me.polygons:
        mname = mats[poly.material_index]
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            c = lin(rgb_for(mname, me.vertices[vi].co, vi))
            data.extend((c[0], c[1], c[2], 1.0))
    col.data.foreach_set("color", data)


def build_gourd(collection):
    big = plain_gourd("gourd_a", "gourd-a", collection, 0.3, 0.36, 12, PALETTE_DEEP, (0.0, 0.0, 0.18))
    small = plain_gourd("gourd_b", "gourd-b", collection, 0.17, 0.22, 10, PALETTE_PALE, (0.33, -0.18, 0.11))
    green = plain_gourd("gourd_c", "gourd-c", collection, 0.13, 0.16, 8, PALETTE_GREEN, (-0.28, -0.24, 0.08))
    small.rotation_euler = (0.25, -0.2, 0.6)
    green.rotation_euler = (-0.2, 0.3, 1.2)
    leaves = []
    for i, (ox, oy, yaw) in enumerate([(-0.12, 0.28, 0.4), (0.24, 0.22, -0.7), (-0.32, 0.05, 1.9)]):
        lbm = leaf_bm("gourd-leaf-%d" % i, 0.16, (ox, oy, 0.02), yaw, 0.04)
        leaf = new_object("gourd_leaf_%d" % i, lbm, collection)
        set_materials(leaf, ["Leaf"])
        leaves.append(leaf)
    for o in [big, small, green]:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        o.select_set(False)
    obj = join([big, small, green] + leaves, "gourd")
    # the leaves got no colour layer of their own: paint the joined mesh's Leaf faces
    me = obj.data
    col = me.color_attributes["Col"]
    mats = [m.name for m in me.materials]
    for poly in me.polygons:
        if mats[poly.material_index] != "Leaf":
            continue
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            t = h01("gourd-leaf-col", poly.index // 20)
            c = lin(mix((0.42, 0.36, 0.08), (0.62, 0.22, 0.04), t))
            col.data[li].color = (c[0], c[1], c[2], 1.0)
    return obj


def tube_bm(bm, points, radius, sides=6):
    """A closed tube swept along a polyline (for wire, cord and scrollwork)."""
    rings = []
    for i, p in enumerate(points):
        a = points[max(0, i - 1)]
        b = points[min(len(points) - 1, i + 1)]
        tdir = (Vector(b) - Vector(a)).normalized()
        up = Vector((0, 0, 1)) if abs(tdir.z) < 0.9 else Vector((1, 0, 0))
        n1 = tdir.cross(up).normalized()
        n2 = tdir.cross(n1).normalized()
        ring = []
        for k in range(sides):
            ang = k / sides * TAU
            ring.append(bm.verts.new(Vector(p) + (n1 * math.cos(ang) + n2 * math.sin(ang)) * radius))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


LANTERN_RIBS = 8


def build_lantern(collection, name="lantern", scale=1.0, with_bracket=True, lean=False):
    """`lean`: a lighter mesh for a lantern that is one of many on a big prop."""
    parts = []
    body_z = -0.44 if with_bracket else 0.0
    body_y = -0.38 if with_bracket else 0.0
    rx, rz = 0.15, 0.19
    # the paper: a squat globe whose panels belly out between the ribs
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=LANTERN_RIBS * (2 if lean else 4), v_segments=10 if lean else 16, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        phi = math.atan2(y, x)
        panel = 0.93 + 0.07 * abs(math.sin(phi * LANTERN_RIBS * 0.5))
        cap = 1.0 - 0.22 * max(0.0, abs(z) - 0.72) / 0.28
        v.co = Vector((x * rx * panel * cap, y * rx * panel * cap, z * rz)) + Vector((0, body_y, body_z))
    body = new_object(name + "_paper", bm, collection)
    set_materials(body, ["LanternPaper"])
    shade_smooth(body, 1.2)
    parts.append(body)
    # the bamboo ribs: thin dark staves along each seam, standing proud of the paper
    rbm = bmesh.new()
    for k in range(LANTERN_RIBS):
        phi = k / LANTERN_RIBS * TAU
        pts = []
        steps = 6 if lean else 12
        for i in range(steps + 1):
            th = lerp(-1.25, 1.25, i / steps)
            z = math.sin(th)
            r = math.cos(th) * 1.02
            cap = 1.0 - 0.22 * max(0.0, abs(z) - 0.72) / 0.28
            pts.append((math.cos(phi) * r * rx * cap * 0.93, body_y + math.sin(phi) * r * rx * cap * 0.93, body_z + z * rz))
        tube_bm(rbm, pts, 0.0055, 3 if lean else 4)
    # lacquered caps, the cord, the tassel
    for zc, r in ((rz * 0.93, 0.072), (-rz * 0.93, 0.086)):
        bmesh.ops.create_cone(rbm, cap_ends=True, segments=16, radius1=r, radius2=r * 0.9, depth=0.04,
                              matrix=Matrix.Translation((0, body_y, body_z + zc)))
    tube_bm(rbm, [(0, body_y, body_z + rz), (0, body_y, body_z + rz + 0.26)], 0.005, 5)
    bmesh.ops.create_cone(rbm, cap_ends=True, segments=10, radius1=0.03, radius2=0.006, depth=0.13,
                          matrix=Matrix.Translation((0, body_y, body_z - rz - 0.085)))
    ribs = new_object(name + "_ribs", rbm, collection)
    set_materials(ribs, ["Iron"])
    shade_smooth(ribs, 0.9)
    parts.append(ribs)
    if with_bracket:
        # the iron bracket: a back plate on the post, a round arm with a stay, a
        # scroll curling under the arm, a finial at its tip
        ibm = bmesh.new()
        bmesh.ops.create_cube(ibm, size=1.0, matrix=Matrix.Translation((0, -0.015, -0.02)) @ Matrix.Diagonal((0.1, 0.025, 0.22, 1)))
        tube_bm(ibm, [(0, -0.02, 0.0), (0, -0.2, 0.01), (0, -0.4, 0.0)], 0.013, 8)
        tube_bm(ibm, [(0, -0.02, -0.17), (0, -0.14, -0.08), (0, -0.26, 0.0)], 0.009, 6)
        scroll = []
        for i in range(24):
            t = i / 23
            a = math.pi * 0.5 + t * TAU * 0.9
            r = 0.065 * (1.0 - 0.55 * t)
            scroll.append((0, -0.27 + math.cos(a) * r, -0.06 + math.sin(a) * r))
        tube_bm(ibm, scroll, 0.007, 6)
        bmesh.ops.create_icosphere(ibm, subdivisions=1, radius=0.02, matrix=Matrix.Translation((0, -0.41, 0.0)))
        tube_bm(ibm, [(0, -0.38, 0.0), (0, -0.38, -0.05), (0, body_y, body_z + rz + 0.26)], 0.006, 5)
        bracket = new_object(name + "_bracket", ibm, collection)
        set_materials(bracket, ["Iron"])
        shade_smooth(bracket, 0.9)
        parts.append(bracket)
    obj = join(parts, name)

    def tint(m, co, vi):
        if m != "LanternPaper":
            return (0.07, 0.06, 0.055)
        phi = math.atan2(co.y - body_y, co.x)
        seam = abs(math.cos(phi * LANTERN_RIBS * 0.5)) ** 10
        zn = (co.z - body_z) / rz
        c = mix((1.0, 0.5, 0.1), (0.86, 0.22, 0.04), seam * 0.6 + 0.25 * zn * zn)
        return c

    color_flat(obj, tint)
    if scale != 1.0:
        obj.scale = (scale, scale, scale)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(scale=True)
    return obj


def build_pole(collection):
    parts = []
    bm = bmesh.new()
    # the turned post: a tapering octagon with two collars
    sides = 8
    rings = []
    profile = [(0.0, 0.1), (0.25, 0.085), (0.3, 0.1), (0.36, 0.08), (3.2, 0.06), (3.25, 0.075),
               (3.3, 0.06), (3.9, 0.055), (3.95, 0.07), (4.05, 0.03)]
    for z, r in profile:
        ring = [bm.verts.new((math.cos(k / sides * TAU) * r, math.sin(k / sides * TAU) * r, z)) for k in range(sides)]
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    # the crossbar the garland ties to
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((0, 0, 3.5)) @ Matrix.Diagonal((0.5, 0.06, 0.06, 1)))
    # four foot braces
    for k in range(4):
        a = k / 4 * TAU + 0.4
        m = Matrix.Translation((math.cos(a) * 0.16, math.sin(a) * 0.16, 0.12)) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(math.radians(50), 4, "Y")
        bmesh.ops.create_cube(bm, size=1.0, matrix=m @ Matrix.Diagonal((0.05, 0.04, 0.36, 1)))
    post = new_object("garland_pole_post", bm, collection)
    set_materials(post, ["Wood"])
    parts.append(post)
    # two ribbons wound up the post, orange and black, half a turn apart
    rbm = bmesh.new()
    turns = 6
    steps = turns * 20
    for strand in range(2):
        prev = None
        for i in range(steps + 1):
            t = i / steps
            a = t * turns * TAU + strand * math.pi
            z = 0.45 + t * 2.7
            post_r = 0.08 - max(0.0, z - 0.36) / 2.84 * 0.02
            r = post_r + 0.007
            p = Vector((math.cos(a) * r, math.sin(a) * r, z))
            w = 0.075
            v0 = rbm.verts.new(p + Vector((0, 0, -w * 0.5)))
            v1 = rbm.verts.new(p + Vector((0, 0, w * 0.5)))
            if prev:
                rbm.faces.new((prev[0], v0, v1, prev[1]))
            prev = (v0, v1)
    ribbon = new_object("garland_pole_ribbon", rbm, collection)
    set_materials(ribbon, ["Ribbon"])
    parts.append(ribbon)
    # a small lantern hanging from the crossbar's end
    lan = build_lantern(collection, "garland_pole_lantern", 0.75, with_bracket=False)
    lan.location = (0.22, 0, 3.24)
    bpy.context.view_layer.objects.active = lan
    lan.select_set(True)
    bpy.ops.object.transform_apply(location=True)
    lan.select_set(False)
    parts.append(lan)
    obj = join(parts, "garland_pole")

    def tint(m, co, vi):
        if m == "Wood":
            g = 0.85 + 0.15 * math.sin(co.z * 9.0 + h01("pole", vi) * 2.0)
            return (0.3 * g, 0.19 * g, 0.1 * g)
        if m == "Ribbon":
            # which strand: the helix angle against the height says it
            a = math.atan2(co.y, co.x) - (co.z - 0.45) / 2.7 * 6 * TAU
            strand = int(round(((a % TAU) / math.pi))) % 2
            return (0.96, 0.42, 0.04) if strand == 0 else (0.08, 0.06, 0.07)
        if m == "LanternPaper":
            return (1.0, 0.56, 0.12)
        return (0.09, 0.08, 0.075)

    me = obj.data
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    color_flat(obj, tint)
    return obj


ROAD_POST_H = 1.95
ROAD_ARM_REACH = 0.58
ROAD_HANG_Z = 1.42


def build_road_lantern(collection):
    """A carved pumpkin hung from a short crook post, for a road's verge between the
    towns (origin = the post's foot; the face and the arm look down Blender -Y, the
    way the decor turns a piece to face its road). A weathered stake driven in with
    two wedges, an orange ribbon tied under a wrought hook, a short chain, and a
    small carved jack-o'-lantern swinging from it, lit from inside."""
    parts = []
    tag = "road-lantern"
    # the stake: an eight-sided post, tapering and leaning a touch, a split top
    bm = bmesh.new()
    sides = 8
    rings = []
    lean = 0.035
    steps = 9
    for i in range(steps + 1):
        t = i / steps
        z = t * ROAD_POST_H
        r = lerp(0.078, 0.056, t) * (1.0 + 0.05 * hs(tag, "knot", i))
        cx = lean * t * t
        ring = []
        for k in range(sides):
            a = k / sides * TAU + 0.2
            ring.append(bm.verts.new((cx + math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    top = bm.faces.new(rings[-1])
    # a chamfered, weathered cap: pull the top ring's centre up into a low point
    res = bmesh.ops.poke(bm, faces=[top])
    for v in res["verts"]:
        v.co.z += 0.05
    # two wedges driven in at the foot
    for k, a in enumerate((0.7, 0.7 + math.pi * 0.95)):
        m = (Matrix.Translation((math.cos(a) * 0.1, math.sin(a) * 0.1, 0.06))
             @ Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(math.radians(-24), 4, "Y"))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m @ Matrix.Diagonal((0.05, 0.07, 0.17, 1)))
    post = new_object("road_lantern_post", bm, collection)
    set_materials(post, ["Wood"])
    color_flat(post, lambda m, co, vi: tuple(
        ch * (0.82 + 0.18 * math.sin(co.z * 11.0 + h01(tag, "grain", vi) * 2.5)) for ch in (0.29, 0.2, 0.12)))
    parts.append(post)
    # the wrought hook: a bar out from the post's head toward the road, a curl at its
    # tip, a stay under it, and a short chain of three links down to the pumpkin
    ibm = bmesh.new()
    head_x = lean
    arm = []
    for i in range(14):
        t = i / 13
        y = -ROAD_ARM_REACH * t
        z = ROAD_POST_H - 0.12 + 0.07 * math.sin(t * math.pi)
        arm.append((head_x, y, z))
    curl = []
    for i in range(16):
        t = i / 15
        a = -math.pi * 0.5 + t * TAU * 0.8
        r = 0.06 * (1.0 - 0.5 * t)
        curl.append((head_x, -ROAD_ARM_REACH - 0.02 + math.cos(a) * r, ROAD_POST_H - 0.06 + math.sin(a) * r))
    tube_bm(ibm, arm, 0.014, 7)
    tube_bm(ibm, curl, 0.009, 6)
    tube_bm(ibm, [(head_x, -0.04, ROAD_POST_H - 0.42), (head_x, -0.22, ROAD_POST_H - 0.24),
                  (head_x, -0.36, ROAD_POST_H - 0.14)], 0.009, 6)
    # two straps round the post holding the bar
    for zc in (ROAD_POST_H - 0.12, ROAD_POST_H - 0.42):
        bmesh.ops.create_cone(ibm, cap_ends=True, segments=10, radius1=0.068, radius2=0.068, depth=0.03,
                              matrix=Matrix.Translation((head_x * (zc / ROAD_POST_H) ** 2, 0, zc)))
    hook_y = -ROAD_ARM_REACH + 0.02
    link_top = ROAD_POST_H - 0.11
    for k in range(3):
        zc = link_top - 0.045 - k * 0.07
        rot = Matrix.Rotation(math.pi * 0.5 * (k % 2), 4, "Z") @ Matrix.Rotation(math.pi * 0.5, 4, "X")
        bmesh.ops.create_cone(ibm, cap_ends=False, segments=8, radius1=0.028, radius2=0.028, depth=0.012,
                              matrix=Matrix.Translation((head_x, hook_y, zc)) @ rot)
    iron = new_object("road_lantern_iron", ibm, collection)
    set_materials(iron, ["Iron"])
    shade_smooth(iron, 0.9)
    color_flat(iron, lambda m, co, vi: (0.075, 0.065, 0.06))
    parts.append(iron)
    # the ribbon: an orange band round the post under the bar, two tails fluttering
    rbm = bmesh.new()
    zb = ROAD_POST_H - 0.55
    prev = None
    first = None
    for k in range(sides + 1):
        a = k / sides * TAU
        r = 0.066
        p = Vector((head_x * 0.6 + math.cos(a) * r, math.sin(a) * r, zb))
        v0 = rbm.verts.new(p + Vector((0, 0, -0.035)))
        v1 = rbm.verts.new(p + Vector((0, 0, 0.035)))
        if prev:
            rbm.faces.new((prev[0], v0, v1, prev[1]))
        else:
            first = (v0, v1)
        prev = (v0, v1)
    for sgn in (-1, 1):
        prev = None
        for i in range(7):
            t = i / 6
            p = Vector((head_x * 0.6 + sgn * (0.03 + 0.05 * t), 0.07 + 0.05 * t,
                        zb - 0.02 - 0.24 * t + 0.03 * math.sin(t * 5.0 + sgn)))
            v0 = rbm.verts.new(p + Vector((-0.028, 0, 0)))
            v1 = rbm.verts.new(p + Vector((0.028, 0, 0)))
            if prev:
                rbm.faces.new((prev[0], v0, v1, prev[1]))
            prev = (v0, v1)
    ribbon = new_object("road_lantern_ribbon", rbm, collection)
    set_materials(ribbon, ["Ribbon"])
    color_flat(ribbon, lambda m, co, vi: (0.95, 0.4, 0.04))
    parts.append(ribbon)
    # the jack-o'-lantern: a small carved pumpkin, its stem tied to the chain
    radius, height = 0.24, 0.34
    pk = carved_pumpkin("road_lantern_pumpkin", "road-lantern-pumpkin", collection, radius, height, 8, "grin",
                        28, 14, PALETTE_ORANGE, shell=0.035, glow_r=0.34)
    pk.location = (head_x, hook_y, ROAD_HANG_Z)
    bpy.context.view_layer.objects.active = pk
    pk.select_set(True)
    bpy.ops.object.transform_apply(location=True)
    pk.select_set(False)
    parts.append(pk)
    cbm = bmesh.new()
    tube_bm(cbm, [(head_x, hook_y, link_top - 0.2), (head_x, hook_y, ROAD_HANG_Z + height * 0.5 + 0.02)], 0.008, 5)
    cord = new_object("road_lantern_cord", cbm, collection)
    set_materials(cord, ["Iron"])
    color_flat(cord, lambda m, co, vi: (0.075, 0.065, 0.06))
    parts.append(cord)
    return join(parts, "road_lantern")


def build_garland_leaf(collection):
    leaves = []
    for i in range(4):
        a = i / 4 * TAU + 0.3
        lbm = leaf_bm("garland-leaf-%d" % i, 0.11, (math.cos(a) * 0.05, math.sin(a) * 0.05, -0.04 * i), a + math.pi / 2, 0.03)
        for v in lbm.verts:
            v.co = Matrix.Rotation(math.radians(70), 4, "X") @ v.co
        leaf = new_object("garland_leaf_%d" % i, lbm, collection)
        set_materials(leaf, ["Leaf"])
        leaves.append(leaf)
    obj = join(leaves, "garland_leaf")
    palette = [(0.78, 0.26, 0.04), (0.9, 0.55, 0.06), (0.55, 0.12, 0.05), (0.64, 0.46, 0.1)]

    def tint(m, co, vi):
        return palette[int(h01("gl", vi // 22) * len(palette)) % len(palette)]

    color_flat(obj, tint)
    return obj


def build_garland_bead(collection):
    """A small paper lantern bead for the strung garland: low poly on purpose,
    a garland strings dozens of them."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x * 0.095, y * 0.095, z * 0.11))
    paper = new_object("garland_bead_paper", bm, collection)
    set_materials(paper, ["LanternPaper"])
    shade_smooth(paper, 1.2)
    cbm = bmesh.new()
    for zc in (0.105, -0.105):
        bmesh.ops.create_cone(cbm, cap_ends=True, segments=8, radius1=0.045, radius2=0.04, depth=0.02,
                              matrix=Matrix.Translation((0, 0, zc)))
    caps = new_object("garland_bead_caps", cbm, collection)
    set_materials(caps, ["Iron"])
    obj = join([paper, caps], "garland_bead")
    color_flat(obj, lambda m, co, vi: (1.0, 0.48, 0.09) if m == "LanternPaper" else (0.07, 0.06, 0.055))
    return obj


def build_decor(collection):
    root = bpy.data.objects.new("GourdlightDecor", None)
    collection.objects.link(root)
    pieces = [
        carved_pumpkin("pumpkin_lit", "pumpkin-lit", collection, 0.36, 0.5, 10, "grin", 40, 22, PALETTE_ORANGE),
        carved_pumpkin("pumpkin_small", "pumpkin-small", collection, 0.24, 0.3, 8, "kind", 32, 18, PALETTE_DEEP,
                       shell=0.04),
        build_gourd(collection),
        build_lantern(collection),
        build_pole(collection),
        build_garland_leaf(collection),
        build_garland_bead(collection),
        stall.build_stall(this, collection),
        stall.corn_shock(this, collection, "corn_shock", "street-shock"),
        stall.build_hay_bale(this, collection),
        build_road_lantern(collection),
    ]
    # Every ground piece sits ON its origin: its lowest point at z = 0.
    for p in pieces:
        if p.name in ("lantern", "garland_pole", "garland_leaf", "garland_bead", "keeper_stall"):
            continue
        min_z = min(v.co.z for v in p.data.vertices)
        for v in p.data.vertices:
            v.co.z -= min_z
    for p in pieces:
        p.parent = root
    return root, pieces


def build_head(collection):
    root = bpy.data.objects.new("GourdlightPumpkinHead", None)
    collection.objects.link(root)
    # no tilt (the face must be symmetric on a head) and the face set lower and
    # a touch larger than a street pumpkin's, so both eyes sit whole on the
    # front of the rind, under the shoulder where the top flattens toward the
    # stem; cut that high, an eye's outer tip ran off the curve.
    head = carved_pumpkin("pumpkin_head", "pumpkin-head", collection, 0.3, 0.46, 10, "fang", 44, 24,
                          PALETTE_ORANGE, neck_hole=0.13, shell=0.035, glow_r=0.26, face_lift=-0.03,
                          tilt=False, face_scale=(0.98, 0.6))
    head.parent = root
    return root, [head]


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def export(root, path):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_vertex_color="NAME",
        export_vertex_color_name="Col",
        export_all_vertex_colors=False,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_materials="EXPORT",
        export_animations=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = argv[argv.index("--out") + 1] if "--out" in argv else None
    blend_out = argv[argv.index("--blend") + 1] if "--blend" in argv else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    decor_col = bpy.data.collections.new("GourdlightDecor")
    bpy.context.scene.collection.children.link(decor_col)
    decor_root, decor = build_decor(decor_col)
    head_col = bpy.data.collections.new("GourdlightPumpkinHead")
    bpy.context.scene.collection.children.link(head_col)
    head_root, head = build_head(head_col)
    print("GOURDLIGHT_REPORT_BEGIN")
    for p in decor + head:
        print("%s tris=%d mats=%s" % (p.name, tri_count(p), ",".join(m.name for m in p.data.materials)))
    print("GOURDLIGHT_REPORT_END")
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        export(decor_root, os.path.join(out_dir, "gourdlight_decor.glb"))
        export(head_root, os.path.join(out_dir, "gourdlight_pumpkin_head.glb"))
    if blend_out:
        bpy.ops.wm.save_as_mainfile(filepath=blend_out)


if __name__ == "__main__":
    main()
