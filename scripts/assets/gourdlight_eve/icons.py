# Gourdlight Eve's item icons, rendered from Blender (woc-item-icon-v1 contract:
# a centred, complete subject on an opaque, dark, painted ground, keyed from the
# top-left with a deep shadow; no text, frame or transparency).
#
#   blender --background --factory-startup --python \
#     scripts/assets/gourdlight_eve/icons.py -- --out <dir>
#
# The carved pumpkin head is the shipped model itself (model.py); the sweet, the
# treat pouch and the Jar of Mischief are built here for their icons only, and so are
# Old Thatchgrin's two spoils: his sweet sack (the pouch's bigger, darker sackcloth
# cousin, tied with straw, sweets spilling at its foot) and the Strawling Charm (a
# little straw doll bound with orange ribbon, two ember beads for eyes).
# The shop's costume draughts (a round flask, its liquid glowing, a charm at its neck: a
# skull, a wisp, a bat) and title writs (a sealed parchment roll), and the Emberbristle
# Broom's reins (the shipped broom itself, appended from broom.py's review .blend,
# `--broom-blend <file>`), are built here too.
# `--only <id,id>` renders just those subjects.
# Writes <dir>/<item-id>.png at 512x512 (the master); scripts/convert_item_icons_webp.mjs
# encodes the 128px shipping WebP.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import model  # noqa: E402  (the shared factory: materials, pumpkins, lanterns)

TAU = math.pi * 2.0


def principled(name, color, rough=0.5, metal=0.0, emit=None, emit_strength=0.0, alpha=1.0, trans=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = emit_strength
    if trans > 0:
        b.inputs["Transmission Weight"].default_value = trans
        b.inputs["IOR"].default_value = 1.45
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
    return mat


def obj_from_bm(name, bm, mat, collection):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    collection.objects.link(o)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return o


def build_sweet(col):
    """A wrapped harvest sweet: an orange-and-black twist of paper round a round
    toffee, the two ends twisted and fanned out."""
    paper = principled("SweetPaper", (1.0, 0.24, 0.0), rough=0.3)
    stripe = principled("SweetStripe", (0.05, 0.04, 0.05), rough=0.4)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=24, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x * 0.55, y * 0.42, z * 0.42))
    body = obj_from_bm("sweet_body", bm, paper, col)
    parts = [body]
    for side in (-1, 1):
        fbm = bmesh.new()
        rings = 8
        sides = 18
        prev = None
        for i in range(rings + 1):
            t = i / rings
            cx = side * (0.5 + t * 0.55)
            r = 0.16 * (1.0 - t) + 0.38 * t * t + 0.05
            ring = []
            for k in range(sides):
                a = k / sides * TAU + t * 1.6 * side
                rr = r * (1.0 + 0.25 * math.cos(a * 6.0) * t)
                ring.append(fbm.verts.new((cx, math.cos(a) * rr, math.sin(a) * rr)))
            if prev:
                for k in range(sides):
                    if side > 0:
                        fbm.faces.new((prev[k], prev[(k + 1) % sides], ring[(k + 1) % sides], ring[k]))
                    else:
                        fbm.faces.new((prev[k], ring[k], ring[(k + 1) % sides], prev[(k + 1) % sides]))
            prev = ring
        end = obj_from_bm("sweet_end_%d" % side, fbm, paper, col)
        sol = end.modifiers.new("s", "SOLIDIFY")
        sol.thickness = 0.02
        parts.append(end)
    # black bands round the middle
    for k, x in enumerate((-0.24, 0.0, 0.24)):
        sbm = bmesh.new()
        bmesh.ops.create_cone(sbm, cap_ends=False, segments=40, radius1=1.0, radius2=1.0, depth=0.07,
                              matrix=Matrix.Translation((x, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
        s = obj_from_bm("sweet_band_%d" % k, sbm, stripe, col)
        rx = 0.55 * math.sqrt(max(0.0, 1.0 - (x / 0.55) ** 2)) + 0.006
        s.scale = (1.0, rx / 1.0 * 0.78, rx * 0.78)
        parts.append(s)
    root = bpy.data.objects.new("sweet", None)
    col.objects.link(root)
    for p in parts:
        p.parent = root
    root.rotation_euler = (0.25, 0.0, 0.45)
    return root


def tube(bm, pts, w, sides=8):
    prev = None
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        t = (b - a).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        n1 = t.cross(up).normalized()
        n2 = t.cross(n1).normalized()
        ring = [bm.verts.new(p + (n1 * math.cos(k / sides * TAU) + n2 * math.sin(k / sides * TAU)) * w) for k in range(sides)]
        if prev:
            for k in range(sides):
                bm.faces.new((prev[k], prev[(k + 1) % sides], ring[(k + 1) % sides], ring[k]))
        prev = ring


def build_pouch(col):
    """A burlap treat pouch, gathered at the neck under an orange cord whose two
    ends hang down the front, a stitched gourd patch on its belly."""
    cloth = principled("PouchCloth", (0.5, 0.33, 0.17), rough=0.95)
    cord = principled("PouchCord", (1.0, 0.36, 0.0), rough=0.55)
    patch = principled("PouchPatch", (1.0, 0.32, 0.0), rough=0.7)
    bm = bmesh.new()
    rings = []
    sides = 40
    # a lathe profile: round belly, pinched neck, a frilled mouth flaring out
    prof = [(0.0, -0.55), (0.42, -0.5), (0.6, -0.3), (0.63, -0.05), (0.55, 0.18), (0.36, 0.34),
            (0.2, 0.42), (0.19, 0.47), (0.27, 0.58), (0.36, 0.66), (0.4, 0.7)]
    for i, (r, z) in enumerate(prof):
        ring = []
        for k in range(sides):
            a = k / sides * TAU
            fold = 1.0 + (0.08 if i >= 7 else 0.035) * math.sin(a * (11 if i >= 7 else 7))
            ring.append(bm.verts.new((math.cos(a) * r * fold, math.sin(a) * r * fold * 0.9, z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    sack = obj_from_bm("pouch_sack", bm, cloth, col)
    sol = sack.modifiers.new("s", "SOLIDIFY")
    sol.thickness = 0.02
    cbm = bmesh.new()
    pts = [Vector((math.cos(a / 30 * TAU) * 0.215, math.sin(a / 30 * TAU) * 0.2, 0.44)) for a in range(31)]
    tube(cbm, pts, 0.03)
    for side in (-1, 1):
        tail = [Vector((side * 0.05 + side * 0.08 * t, -0.23 - 0.4 * math.sin(t * 1.4), 0.42 - 0.36 * t))
                for t in [i / 12 for i in range(13)]]
        tube(cbm, tail, 0.022)
        bmesh.ops.create_icosphere(cbm, subdivisions=1, radius=0.045, matrix=Matrix.Translation(tail[-1]))
    tie = obj_from_bm("pouch_tie", cbm, cord, col)
    # the stitched gourd patch: a ribbed disc on the belly with a little stem
    pbm = bmesh.new()
    center = pbm.verts.new((0, -0.605, -0.12))
    ring = []
    for k in range(36):
        a = k / 36 * TAU
        r = 0.2 * (1.0 - 0.08 * (1 - abs(math.cos(a * 2.5))))
        ring.append(pbm.verts.new((math.cos(a) * r * 1.15, -0.59, -0.12 + math.sin(a) * r * 0.9)))
    for k in range(36):
        pbm.faces.new((center, ring[k], ring[(k + 1) % 36]))
    gourd_patch = obj_from_bm("pouch_patch", pbm, patch, col)
    root = bpy.data.objects.new("pouch", None)
    col.objects.link(root)
    for p in (sack, tie, gourd_patch):
        p.parent = root
    root.rotation_euler = (0.0, 0.0, 0.25)
    return root


def build_sack(col):
    """Old Thatchgrin's sweet sack: the pouch's shape, bigger and darker, a straw tie at
    the neck, three wrapped sweets spilling round its foot."""
    root = build_pouch(col)
    for c in root.children:
        for m in c.data.materials:
            b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            if m.name.startswith("PouchCloth"):
                b.inputs["Base Color"].default_value = (0.3, 0.2, 0.11, 1.0)
            elif m.name.startswith("PouchPatch"):
                b.inputs["Base Color"].default_value = (0.08, 0.06, 0.05, 1.0)
                b.inputs["Emission Color"].default_value = (1.0, 0.45, 0.08, 1.0)
                b.inputs["Emission Strength"].default_value = 0.6
    import scarecrow

    straw = principled("SackStraw", (0.86, 0.68, 0.32), rough=0.9)
    tuft = scarecrow.straw_tuft("sack-icon", (0.0, 0.0, 0.47), (0, -0.2, 1), 40, 0.32, 0.9, 0.012, 0.3)
    obj_from_bm("sack_straw", tuft, straw, col).parent = root
    for i, (x, y, rz) in enumerate(((-0.62, -0.4, 0.4), (0.55, -0.48, -0.6), (0.05, -0.72, 1.2))):
        sweet = build_sweet(col)
        sweet.scale = (0.42, 0.42, 0.42)
        sweet.location = (x, y, -0.48)
        sweet.rotation_euler = (0.3, 0.0, rz)
        sweet.parent = root
    root.scale = (1.05, 1.05, 1.05)
    return root


def build_charm(col):
    """The Strawling Charm: a little straw doll, its head, arms and legs bound off with
    orange ribbon, two ember beads for eyes."""
    import scarecrow

    straw = principled("CharmStraw", (0.9, 0.72, 0.34), rough=0.85)
    ribbon = principled("CharmRibbon", (1.0, 0.34, 0.02), rough=0.5)
    ember = principled("CharmEmber", (1.0, 0.6, 0.2), emit=(1.0, 0.5, 0.1), emit_strength=8.0)
    root = bpy.data.objects.new("charm", None)
    col.objects.link(root)
    parts = [
        ("charm_tuft", (0, 0, 0.8), (0, 0.1, 1), 40, 0.16, 0.5),
        ("charm_body", (0, 0, 0.55), (0, 0, -1), 90, 0.34, 0.1),
        ("charm_leg_l", (0.035, 0, 0.22), (0.25, 0, -1), 40, 0.3, 0.08),
        ("charm_leg_r", (-0.035, 0, 0.22), (-0.25, 0, -1), 40, 0.3, 0.08),
        ("charm_arm_l", (0.03, 0, 0.44), (1, 0, -0.55), 30, 0.32, 0.08),
        ("charm_arm_r", (-0.03, 0, 0.44), (-1, 0, -0.55), 30, 0.32, 0.08),
    ]
    for name, o, d, n, ln, spread in parts:
        bm = scarecrow.straw_tuft(name, o, d, n, ln, spread, 0.016, 0.02)
        obj_from_bm(name, bm, straw, col).parent = root
    hbm = bmesh.new()
    bmesh.ops.create_icosphere(hbm, subdivisions=3, radius=0.17, matrix=Matrix.Translation((0, 0, 0.68)))
    obj_from_bm("charm_skull", hbm, straw, col).parent = root
    rbm = bmesh.new()
    for z, r in ((0.53, 0.055), (0.27, 0.07)):
        pts = [Vector((math.cos(a / 20 * TAU) * r, math.sin(a / 20 * TAU) * r, z)) for a in range(21)]
        tube(rbm, pts, 0.025)
    for side in (-1, 1):
        pts = [Vector((side * (0.03 + 0.05 * t), -0.06 - 0.05 * t, 0.53 - 0.22 * t)) for t in [i / 8 for i in range(9)]]
        tube(rbm, pts, 0.02)
    obj_from_bm("charm_ribbon", rbm, ribbon, col).parent = root
    ebm = bmesh.new()
    for side in (-1, 1):
        bmesh.ops.create_icosphere(ebm, subdivisions=2, radius=0.03, matrix=Matrix.Translation((side * 0.06, -0.15, 0.7)))
    obj_from_bm("charm_eyes", ebm, ember, col).parent = root
    root.rotation_euler = (0.0, 0.2, 0.3)
    return root


def build_jar(col):
    """A squat glass jar, cork stopper tied with black ribbon, green fumes
    swirling inside it and leaking from under the cork."""
    glass = principled("JarGlass", (0.6, 0.85, 0.72), rough=0.06, alpha=0.32)
    cork = principled("JarCork", (0.52, 0.36, 0.2), rough=0.85)
    ribbon = principled("JarRibbon", (0.04, 0.03, 0.05), rough=0.45)
    fume = principled("JarFume", (0.3, 0.95, 0.35), rough=0.6, emit=(0.25, 1.0, 0.2), emit_strength=1.6)
    bm = bmesh.new()
    prof = [(0.0, 0.0), (0.42, 0.0), (0.5, 0.08), (0.52, 0.55), (0.42, 0.72), (0.27, 0.8), (0.27, 0.92), (0.3, 0.95)]
    rings = []
    sides = 40
    for r, z in prof:
        rings.append([bm.verts.new((math.cos(k / sides * TAU) * r, math.sin(k / sides * TAU) * r, z)) for k in range(sides)])
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    jar = obj_from_bm("jar_glass", bm, glass, col)
    sol = jar.modifiers.new("s", "SOLIDIFY")
    sol.thickness = 0.03
    cbm = bmesh.new()
    bmesh.ops.create_cone(cbm, cap_ends=True, segments=24, radius1=0.25, radius2=0.29, depth=0.2,
                          matrix=Matrix.Translation((0, 0, 1.0)))
    stopper = obj_from_bm("jar_cork", cbm, cork, col)
    rbm = bmesh.new()
    bmesh.ops.create_cone(rbm, cap_ends=False, segments=32, radius1=0.285, radius2=0.285, depth=0.06,
                          matrix=Matrix.Translation((0, 0, 0.86)))
    rib = obj_from_bm("jar_ribbon", rbm, ribbon, col)
    sol2 = rib.modifiers.new("s", "SOLIDIFY")
    sol2.thickness = 0.03
    parts = [jar, stopper, rib]
    # the fumes: a twisted glowing wisp coiling up inside and a curl escaping
    fbm = bmesh.new()
    prev = None
    n = 60
    for i in range(n + 1):
        t = i / n
        a = t * TAU * 2.4
        r = 0.22 * (1.0 - 0.4 * t) + 0.05 * math.sin(t * 17.0)
        c = Vector((math.cos(a) * r, math.sin(a) * r, 0.12 + t * 0.6))
        w = 0.07 * (1.0 - 0.6 * abs(t - 0.5))
        ring = [fbm.verts.new(c + Vector((math.cos(k / 8 * TAU) * w, math.sin(k / 8 * TAU) * w, 0))) for k in range(8)]
        if prev:
            for k in range(8):
                fbm.faces.new((prev[k], prev[(k + 1) % 8], ring[(k + 1) % 8], ring[k]))
        prev = ring
    parts.append(obj_from_bm("jar_fume", fbm, fume, col))
    ebm = bmesh.new()
    prev = None
    for i in range(31):
        t = i / 30
        c = Vector((0.27 + t * 0.25 + 0.05 * math.sin(t * 9), 0.05 * math.cos(t * 7), 1.0 + t * 0.35))
        w = 0.04 * (1.0 - t) + 0.008
        ring = [ebm.verts.new(c + Vector((math.cos(k / 8 * TAU) * w, 0, math.sin(k / 8 * TAU) * w))) for k in range(8)]
        if prev:
            for k in range(8):
                ebm.faces.new((prev[k], prev[(k + 1) % 8], ring[(k + 1) % 8], ring[k]))
        prev = ring
    parts.append(obj_from_bm("jar_wisp", ebm, fume, col))
    root = bpy.data.objects.new("jar", None)
    col.objects.link(root)
    for p in parts:
        p.parent = root
    root.rotation_euler = (0.12, 0.0, 0.3)
    return root


def lathe(bm, profile, segs=28):
    """A solid of revolution round Z from (radius, z) pairs, bottom to top, capped."""
    rings = []
    for r, z in profile:
        rings.append([bm.verts.new((math.cos(a / segs * TAU) * r, math.sin(a / segs * TAU) * r, z)) for a in range(segs)])
    for i in range(len(rings) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    return rings


def build_draught(col, tag, liquid, glow, extra):
    """A costume draught: a round-bellied glass flask with a long neck, a cork tied with
    twine, the liquid glowing faintly inside, and a little charm hung at its neck that says
    which costume it holds (`extra`: 'skull', 'wisp' or 'bat')."""
    root = bpy.data.objects.new("draught_" + tag, None)
    col.objects.link(root)
    glass = principled("DraughtGlass_" + tag, (0.75, 0.85, 0.82), rough=0.05, alpha=0.3)
    liq = principled("DraughtLiquid_" + tag, liquid, rough=0.2, emit=glow, emit_strength=0.35)
    cork = principled("DraughtCork_" + tag, (0.5, 0.34, 0.18), rough=0.85)
    twine = principled("DraughtTwine_" + tag, (0.62, 0.5, 0.3), rough=0.9)
    profile = [(0.02, 0.0), (0.3, 0.03), (0.42, 0.18), (0.46, 0.36), (0.42, 0.56), (0.28, 0.7), (0.13, 0.8), (0.12, 1.02), (0.14, 1.06)]
    bm = bmesh.new()
    lathe(bm, profile)
    obj_from_bm("draught_glass_" + tag, bm, glass, col).parent = root
    bm = bmesh.new()
    lathe(bm, [(0.02, 0.03), (0.27, 0.06), (0.39, 0.19), (0.42, 0.36), (0.38, 0.52), (0.25, 0.62), (0.02, 0.63)])
    obj_from_bm("draught_liquid_" + tag, bm, liq, col).parent = root
    bm = bmesh.new()
    lathe(bm, [(0.1, 0.98), (0.11, 1.05), (0.13, 1.16), (0.12, 1.2), (0.02, 1.21)], 16)
    obj_from_bm("draught_cork_" + tag, bm, cork, col).parent = root
    bm = bmesh.new()
    pts = [Vector((math.cos(a / 20 * TAU) * 0.135, math.sin(a / 20 * TAU) * 0.135, 0.9)) for a in range(21)]
    tube(bm, pts, 0.018)
    tube(bm, [Vector((0.12, -0.05, 0.9)), Vector((0.2, -0.12, 0.78)), Vector((0.24, -0.16, 0.62))], 0.012)
    obj_from_bm("draught_twine_" + tag, bm, twine, col).parent = root
    charm_at = Vector((0.25, -0.18, 0.56))
    if extra == "skull":
        bone = principled("DraughtBone", (0.92, 0.88, 0.76), rough=0.6)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.12, matrix=Matrix.Translation(charm_at))
        bmesh.ops.create_cube(bm, size=0.12, matrix=Matrix.Translation(charm_at + Vector((0, 0, -0.07))) @ Matrix.Diagonal((0.9, 0.7, 0.6, 1)))
        obj_from_bm("draught_skull", bm, bone, col).parent = root
        eye = principled("DraughtSkullEye", (0.02, 0.02, 0.02), rough=0.9)
        bm = bmesh.new()
        for s in (-1, 1):
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.032, matrix=Matrix.Translation(charm_at + Vector((s * 0.045, -0.1, 0.0))))
        obj_from_bm("draught_skull_eyes", bm, eye, col).parent = root
    elif extra == "wisp":
        wisp = principled("DraughtWisp", (0.85, 0.92, 1.0), rough=0.3, emit=(0.7, 0.85, 1.0), emit_strength=2.5)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.08, matrix=Matrix.Translation(charm_at))
        tube(bm, [charm_at + Vector((0, 0, -0.04)), charm_at + Vector((0.03, 0.02, -0.12)), charm_at + Vector((-0.02, 0.0, -0.19))], 0.045)
        obj_from_bm("draught_wisp", bm, wisp, col).parent = root
        # a curl of mist rising from the cork
        bm = bmesh.new()
        tube(bm, [Vector((0.05 * math.sin(t * 5.5), -0.02, 1.22 + 0.42 * t)) for t in [i / 12 for i in range(13)]], 0.03)
        obj_from_bm("draught_mist", bm, wisp, col).parent = root
    else:
        wing = principled("DraughtBatWing", (0.12, 0.05, 0.14), rough=0.6)
        bm = bmesh.new()
        for s in (-1, 1):
            verts = [bm.verts.new(charm_at + Vector((0, -0.01, 0)))]
            for i in range(6):
                t = i / 5
                verts.append(bm.verts.new(charm_at + Vector((s * (0.04 + 0.16 * t), -0.01, 0.06 - 0.04 * math.sin(t * math.pi * 2.5) - 0.05 * t))))
            for i in range(1, len(verts) - 1):
                bm.faces.new((verts[0], verts[i], verts[i + 1]))
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.045, matrix=Matrix.Translation(charm_at))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.01)
        obj_from_bm("draught_bat", bm, wing, col).parent = root
    root.rotation_euler = (0.0, 0.08, 0.35)
    return root


def build_writ(col, tag, ribbon_rgb, seal_rgb, seal_glow):
    """A title writ: a rolled parchment scroll, its edge unfurled a little, tied with a
    ribbon and closed with a wax seal pressed with a carved pumpkin."""
    root = bpy.data.objects.new("writ_" + tag, None)
    col.objects.link(root)
    paper = principled("WritPaper_" + tag, (0.86, 0.76, 0.56), rough=0.9)
    ribbon = principled("WritRibbon_" + tag, ribbon_rgb, rough=0.5)
    wax = principled("WritWax_" + tag, seal_rgb, rough=0.35, emit=seal_glow, emit_strength=0.4)
    bm = bmesh.new()
    segs = 28
    rings = []
    for i in range(9):
        x = -0.75 + 1.5 * i / 8
        r = 0.2 + 0.015 * math.sin(i * 1.7)
        rings.append([bm.verts.new((x, math.cos(a / segs * TAU) * r, math.sin(a / segs * TAU) * r)) for a in range(segs)])
    for i in range(8):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    for end in (rings[0], rings[-1]):
        bm.faces.new(end)
    obj_from_bm("writ_roll_" + tag, bm, paper, col).parent = root
    # the unfurled tongue of parchment hanging off the roll
    bm = bmesh.new()
    vs = []
    for i in range(7):
        t = i / 6
        y = -0.2 - 0.35 * t
        z = -0.05 - 0.25 * t * t
        vs.append((bm.verts.new((-0.7, y, z)), bm.verts.new((0.7, y, z))))
    for i in range(6):
        bm.faces.new((vs[i][0], vs[i][1], vs[i + 1][1], vs[i + 1][0]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    obj_from_bm("writ_tongue_" + tag, bm, paper, col).parent = root
    bm = bmesh.new()
    for x in (-0.05, 0.05):
        pts = [Vector((x, math.cos(a / 24 * TAU) * 0.215, math.sin(a / 24 * TAU) * 0.215)) for a in range(25)]
        tube(bm, pts, 0.03)
    tube(bm, [Vector((0, -0.21, -0.05)), Vector((-0.12, -0.3, -0.3)), Vector((-0.18, -0.34, -0.52))], 0.028)
    tube(bm, [Vector((0, -0.21, -0.05)), Vector((0.1, -0.31, -0.32)), Vector((0.14, -0.35, -0.55))], 0.028)
    obj_from_bm("writ_ribbon_" + tag, bm, ribbon, col).parent = root
    # the seal: a wax disc, its rim spread, a carved pumpkin pressed into it
    bm = bmesh.new()
    seal_c = Vector((0, -0.24, 0.0))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.21, radius2=0.19, depth=0.05,
                          matrix=Matrix.Translation(seal_c) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    for k in range(8):
        a = k / 8 * TAU
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.04, matrix=Matrix.Translation(seal_c + Vector((math.cos(a) * 0.21, -0.005, math.sin(a) * 0.21))))
    obj_from_bm("writ_seal_" + tag, bm, wax, col).parent = root
    face = principled("WritSealFace_" + tag, tuple(c * 0.4 for c in seal_rgb), rough=0.4)
    bm = bmesh.new()
    for s in (-1, 1):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=3, radius1=0.03, radius2=0.03, depth=0.02,
                              matrix=Matrix.Translation(seal_c + Vector((s * 0.045, -0.03, 0.03))) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(seal_c + Vector((0, -0.03, -0.04))) @ Matrix.Diagonal((0.12, 0.02, 0.025, 1)))
    obj_from_bm("writ_seal_face_" + tag, bm, face, col).parent = root
    root.rotation_euler = (0.25, 0.0, 0.5)
    return root


def build_broom(col, blend):
    """The Emberbristle Broom's reins icon: the shipped broom itself, appended from the
    factory's review .blend (broom.py), laid on a slant so its whole length reads."""
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == "Broom"]
    root = bpy.data.objects.new("broom_icon", None)
    col.objects.link(root)
    for o in dst.objects:
        if o is None:
            continue
        o.modifiers.clear()
        o.parent = None
        col.objects.link(o)
        o.parent = root
        for m in o.data.materials:
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m else None
            if b and m.name in ("BroomEmber", "GourdGlow", "GourdInner", "GourdFlesh"):
                b.inputs["Emission Strength"].default_value = 4.0
    # lengthwise across the card, tipped on a diagonal, crook to the upper left
    root.matrix_world = Matrix.Rotation(-0.62, 4, "Y") @ Matrix.Rotation(math.pi / 2, 4, "Z") @ Matrix.Rotation(0.35, 4, "Y")
    return root


def painted_ground(col):
    """The dark painted backdrop: a cyclorama card with a warm-to-umber falloff."""
    mat = bpy.data.materials.new("Backdrop")
    mat.use_nodes = True
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 3.5
    tex.inputs["Detail"].default_value = 6.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.035, 0.022, 0.018, 1)
    ramp.color_ramp.elements[1].color = (0.11, 0.06, 0.035, 1)
    nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 1.0
    me = bpy.data.meshes.new("backdrop")
    me.from_pydata([(-6, 3, -3), (6, 3, -3), (6, 3, 6), (-6, 3, 6)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new("backdrop", me)
    me.materials.append(mat)
    col.objects.link(o)
    return o


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.015, 0.012, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.4
    key = bpy.data.objects.new("key", bpy.data.lights.new("key", "AREA"))
    key.data.energy = 220
    key.data.size = 1.6
    key.location = (-2.6, -2.4, 3.2)
    key.rotation_euler = (Vector((0, 0, 0.3)) - key.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(key)
    rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", "AREA"))
    rim.data.energy = 60
    rim.data.color = (1.0, 0.7, 0.4)
    rim.location = (2.4, 1.5, 1.8)
    rim.rotation_euler = (Vector((0, 0, 0.3)) - rim.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(rim)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene, cam


def frame(cam, obj, pad=1.3):
    bpy.context.view_layer.update()
    pts = []
    for o in [obj] + list(obj.children_recursive):
        if o.type == "MESH":
            pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr = (lo + hi) / 2
    size = max(hi.x - lo.x, hi.z - lo.z, hi.y - lo.y)
    cam.location = ctr + Vector((0.0, -6.0, 1.4))
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = size * pad


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1]
    only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene, cam = setup_scene()
    col = bpy.data.collections.new("icons")
    scene.collection.children.link(col)
    painted_ground(col)
    # the head: the shipped factory's own pumpkin head, its glow up
    head_col = bpy.data.collections.new("head")
    scene.collection.children.link(head_col)
    _, (head,) = model.build_head(head_col)
    for m in bpy.data.materials:
        if m.name in ("GourdFlesh", "GourdInner", "GourdGlow"):
            b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            b.inputs["Emission Strength"].default_value = 5.0
        elif m.name == "GourdLitSkin":
            # the rind's night glow is the game's to drive; the painting is lit by day
            b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            b.inputs["Emission Strength"].default_value = 0.0
    head.rotation_euler = (0.0, 0.0, -0.35)
    subjects = {
        "carved_pumpkin_head": head,
        "gourdlight_sweet": build_sweet(col),
        "gourdlight_treat_pouch": build_pouch(col),
        "jar_of_mischief": build_jar(col),
        "thatchgrin_sweet_sack": build_sack(col),
        "strawling_charm": build_charm(col),
        # the shop's costume draughts and title writs, and Old Thatchgrin's broom
        "rattlebone_draught": build_draught(col, "skel", (0.62, 0.56, 0.36), (0.5, 0.45, 0.25), "skull"),
        "haunting_draught": build_draught(col, "ghost", (0.3, 0.52, 0.78), (0.35, 0.6, 1.0), "wisp"),
        "batwing_draught": build_draught(col, "bat", (0.2, 0.03, 0.26), (0.45, 0.08, 0.55), "bat"),
        "writ_of_the_gourdlit": build_writ(col, "gourdlit", (1.0, 0.42, 0.04), (0.9, 0.36, 0.05), (1.0, 0.5, 0.1)),
        "writ_of_the_trickster": build_writ(col, "trickster", (0.2, 0.55, 0.12), (0.18, 0.5, 0.12), (0.3, 0.9, 0.2)),
        "writ_of_the_hollow_grin": build_writ(col, "hollow", (0.06, 0.05, 0.07), (0.32, 0.05, 0.08), (0.6, 0.1, 0.1)),
    }
    broom_blend = argv[argv.index("--broom-blend") + 1] if "--broom-blend" in argv else os.path.join(
        HERE, "..", "..", "..", "tmp", "asset_src", "gourdlight_eve", "broom.blend")
    if os.path.exists(broom_blend):
        subjects["reins_emberbristle_broom"] = build_broom(col, broom_blend)
    for o in subjects.values():
        o.hide_render = True
        for c in o.children_recursive:
            c.hide_render = True
    for item_id, o in subjects.items():
        if only is not None and item_id not in only:
            continue
        o.hide_render = False
        for c in o.children_recursive:
            c.hide_render = False
        frame(cam, o, 1.25 if item_id not in ("gourdlight_sweet", "reins_emberbristle_broom") else 1.1)
        scene.render.filepath = os.path.join(out, item_id + ".png")
        bpy.ops.render.render(write_still=True)
        o.hide_render = True
        for c in o.children_recursive:
            c.hide_render = True


if __name__ == "__main__":
    main()
