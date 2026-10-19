# The Gourdlight Guise Feat crest (Book of Deeds art for feat_gourdlight_guise),
# rendered from Blender in the shape every painted deed crest shares: a round
# gilded frame with four compass points and studs, a deep painted field inside
# with gilt filigree, the subject at its heart. The subject is the shipped Carved
# Pumpkin Head itself (model.py), lit from inside, on a fan of autumn leaves.
#
#   blender --background --factory-startup --python \
#     scripts/assets/gourdlight_eve/crest.py -- --out <dir>
#
# `--subject thatchgrin` paints the field-boss Feat instead (feat_old_thatchgrin): his
# rusted scythe crossed behind his own carved head, straw at its foot, on an ember field.
#
# `--subject title_gourdlit|title_trickster|title_hollow` paints the three title-writ Feats
# (feat_title_gourdlit, feat_title_trickster, feat_title_hollow_grinned): the sealed
# parchment writ crossed behind the head, each on its own field (amber, a trickster's
# green, a hollow crimson).
#
# `--subject pumpkin_hunter` paints the Haunted Pumpkin hunt's Feat (feat_pumpkin_hunter):
# the lit head on a moonlit midnight field, a row of dark unfound pumpkins at its foot.
#
# Round 12's whole-event checklist: `--subject doorsteps` (feat_gourdlight_doorsteps: an
# oak door with an iron knocker behind the head, on a hearth-brown field), `errands`
# (feat_gourdlight_errands: Hester's errand list rolled behind the head, a green ribbon,
# on a deep teal field), `frights` (feat_gourdlight_frights: three little sheet-ghosts
# leaping round the head, on a pale moonlit violet), and `eve_complete`
# (feat_gourdlight_eve_complete, the Gourdsworn: the scythe crossed behind the head, a
# crown of four lit pumpkins round it, on a rich gilt-amber field).
#
# Writes <dir>/<deed id>.png (512x512, transparent outside the frame); scripts/convert_deed_icons_webp.mjs <dir> encodes the shipping 128px
# WebP and regenerates src/ui/deed_image_ids.ts. Deterministic: no clock, no
# `random`.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import model  # noqa: E402  (the shared factory: the pumpkin head, leaves)

TAU = math.pi * 2.0


def principled(name, color, rough=0.5, metal=0.0, emit=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = strength
    return mat


def field_material():
    """The painted field: a deep night violet warming toward the middle, mottled
    like a brushed ground, matte (no highlight)."""
    mat = bpy.data.materials.new("CrestField")
    mat.use_nodes = True
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = "SPHERICAL"
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1.05, 1.05, 1.05)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], grad.inputs["Vector"])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 6.0
    noise.inputs["Detail"].default_value = 8.0
    nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
    mixn = nt.nodes.new("ShaderNodeMix")
    mixn.data_type = "FLOAT"
    mixn.inputs["Factor"].default_value = 0.22
    nt.links.new(grad.outputs["Fac"], mixn.inputs["A"])
    nt.links.new(noise.outputs["Fac"], mixn.inputs["B"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.01, 0.012, 0.045, 1)
    ramp.color_ramp.elements[1].color = (0.16, 0.05, 0.06, 1)
    ramp.color_ramp.elements.new(0.5).color = (0.04, 0.03, 0.1, 1)
    nt.links.new(mixn.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 1.0
    b.inputs["Specular IOR Level"].default_value = 0.0
    return mat


def bloom_material():
    """A soft candle bloom painted on the field behind the head."""
    mat = bpy.data.materials.new("CrestBloom")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = "QUADRATIC_SPHERE"
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1.6, 1.6, 1.6)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], grad.inputs["Vector"])
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (1.0, 0.4, 0.07, 1)
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = 1.6
    nt.links.new(grad.outputs["Fac"], mul.inputs[0])
    nt.links.new(mul.outputs["Value"], emit.inputs["Strength"])
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(transp.outputs[0], add.inputs[0])
    nt.links.new(emit.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    mat.surface_render_method = "BLENDED"
    return mat


def obj(name, bm, mat, col, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    return o


def ring(bm, radius, minor, y, segs=96, sides=10):
    """A torus in the XZ plane (the crest faces -Y, toward the camera)."""
    verts = []
    for i in range(segs):
        a = i / segs * TAU
        c = Vector((math.cos(a) * radius, y, math.sin(a) * radius))
        out = Vector((math.cos(a), 0.0, math.sin(a)))
        row = []
        for k in range(sides):
            b = k / sides * TAU
            row.append(bm.verts.new(c + out * math.cos(b) * minor + Vector((0, -1, 0)) * math.sin(b) * minor))
        verts.append(row)
    for i in range(segs):
        r0, r1 = verts[i], verts[(i + 1) % segs]
        for k in range(sides):
            bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))


def disc(radius, depth, y):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=radius, radius2=radius, depth=depth,
                          matrix=Matrix.Translation((0, y, 0)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    return bm


SUBJECT = ["guise"]


def thatchgrin_scythe(col):
    """Old Thatchgrin's scythe (scarecrow.py), laid diagonally behind the head."""
    import scarecrow

    scarecrow.PARTS.clear()
    scarecrow.build_scythe(1.0, {})
    objs = [scarecrow.finish_part(p, []) for p in scarecrow.PARTS]
    for o in objs:
        for c in o.users_collection:
            c.objects.unlink(o)
        col.objects.link(o)
    sc = scarecrow.join(objs, "crest_scythe")
    # the snath runs up through the hand at (-2.18, 0, 3.1): centre it and lay it across
    k = 0.5
    # the hand (where the snath is gripped) to the crest's middle, the blade swung to lie
    # flat across the field (it is authored pointing at the viewer), tilted on a diagonal
    m = (Matrix.Translation((0.0, -0.08, 0.05)) @ Matrix.Rotation(-0.75, 4, "Y")
         @ Matrix.Scale(k, 4) @ Matrix.Rotation(-math.pi / 2, 4, "Z")
         @ Matrix.Translation((2.18, 0.0, -3.1 - 0.3)))
    sc.data.transform(m)
    for poly in sc.data.polygons:
        poly.use_smooth = True
    return sc


TITLE_FIELDS = {
    "title_gourdlit": [(0.05, 0.02, 0.004, 1), (0.42, 0.19, 0.03, 1), (0.16, 0.07, 0.012, 1)],
    "title_trickster": [(0.008, 0.03, 0.01, 1), (0.08, 0.3, 0.07, 1), (0.02, 0.1, 0.03, 1)],
    "title_hollow": [(0.03, 0.004, 0.008, 1), (0.3, 0.02, 0.05, 1), (0.1, 0.006, 0.02, 1)],
}
TITLE_RIBBON = {
    "title_gourdlit": (1.0, 0.42, 0.04),
    "title_trickster": (0.2, 0.6, 0.12),
    "title_hollow": (0.08, 0.06, 0.08),
}
TITLE_DEEDS = {
    "title_gourdlit": "feat_title_gourdlit",
    "title_trickster": "feat_title_trickster",
    "title_hollow": "feat_title_hollow_grinned",
}


def title_writ(col, subject):
    """The writ behind the head: a parchment roll laid on a diagonal, a ribbon round it."""
    paper = principled("CrestParchment", (0.88, 0.78, 0.56), rough=0.85)
    ribbon = principled("CrestRibbon", TITLE_RIBBON[subject], rough=0.45)
    bm = bmesh.new()
    segs = 24
    rings = []
    for i in range(9):
        x = -0.82 + 1.64 * i / 8
        r = 0.13 + 0.01 * math.sin(i * 1.9)
        rings.append([bm.verts.new((x, 0.12 + math.cos(a / segs * TAU) * r, math.sin(a / segs * TAU) * r)) for a in range(segs)])
    for i in range(8):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    for end in (rings[0], rings[-1]):
        bm.faces.new(end)
    roll = obj("crest_writ", bm, paper, col)
    rb = bmesh.new()
    for x in (-0.38, 0.38):
        pts = [(x, 0.12 + math.cos(a / 20 * TAU) * 0.15, math.sin(a / 20 * TAU) * 0.15) for a in range(21)]
        model.tube_bm(rb, pts, 0.03, 6)
    rib = obj("crest_writ_ribbon", rb, ribbon, col)
    for o in (roll, rib):
        o.rotation_euler = (0.0, 0.62, 0.0)


PUMPKIN_HUNTER_FIELD = [(0.004, 0.012, 0.03, 1), (0.05, 0.16, 0.3, 1), (0.015, 0.05, 0.1, 1)]


def hunter_row(col):
    """The hunt itself: small dark pumpkins, still unlit, along the field's lower rim."""
    skin = principled("HuntSkin", (0.34, 0.13, 0.035), rough=0.55)
    stem = principled("HuntStem", (0.12, 0.09, 0.04), rough=0.8)
    for i, (x, z, rad) in enumerate(((-0.56, -0.5, 0.14), (0.56, -0.5, 0.14), (-0.28, -0.68, 0.12), (0.28, -0.68, 0.12))):
        bm = model.pumpkin_bm("crest-hunt-%d" % i, rad, rad * 1.6, 8, 24, 12)
        o = obj("hunt_pumpkin_%d" % i, bm, skin, col)
        o.location = (x, -0.75, z)
        sbm = bmesh.new()
        model.tube_bm(sbm, [(0.0, 0.0, 0.0), (0.01, 0.0, rad * 0.45)], rad * 0.14, 6)
        st = obj("hunt_stem_%d" % i, sbm, stem, col)
        st.location = (x, -0.75, z + rad * 0.6)


ROUND12_FIELDS = {
    "doorsteps": [(0.02, 0.012, 0.03, 1), (0.2, 0.1, 0.24, 1), (0.07, 0.035, 0.09, 1)],
    "errands": [(0.004, 0.025, 0.03, 1), (0.04, 0.28, 0.3, 1), (0.012, 0.09, 0.1, 1)],
    "frights": [(0.03, 0.02, 0.06, 1), (0.36, 0.3, 0.55, 1), (0.12, 0.09, 0.2, 1)],
    "eve_complete": [(0.04, 0.012, 0.03, 1), (0.42, 0.2, 0.04, 1), (0.16, 0.05, 0.06, 1)],
}
ROUND12_DEEDS = {
    "doorsteps": "feat_gourdlight_doorsteps",
    "errands": "feat_gourdlight_errands",
    "frights": "feat_gourdlight_frights",
    "eve_complete": "feat_gourdlight_eve_complete",
}


def door_behind(col):
    """A tall arched oak door behind the head: planks standing proud on both sides of it,
    iron straps across, and a ring knocker above its brow."""
    oak = principled("DoorOak", (0.3, 0.16, 0.07), rough=0.72)
    iron = principled("DoorIron", (0.1, 0.09, 0.09), rough=0.4, metal=0.9)
    bm = bmesh.new()
    for i in range(7):
        x = -0.6 + i * 0.2
        top = 0.5 + 0.28 * math.sqrt(max(0.0, 1.0 - (x / 0.72) ** 2))
        bot = -0.7
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((x, 0.0, (top + bot) / 2))
                              @ Matrix.Diagonal((0.185, 0.06, top - bot, 1.0)))
    obj("door_planks", bm, oak, col, smooth=False)
    sb = bmesh.new()
    for z in (-0.45, 0.3):
        bmesh.ops.create_cube(sb, size=1.0, matrix=Matrix.Translation((0.0, -0.045, z))
                              @ Matrix.Diagonal((1.38, 0.03, 0.07, 1.0)))
    pts = [(math.cos(a / 20 * TAU) * 0.1, -0.1, 0.62 + math.sin(a / 20 * TAU) * 0.1) for a in range(21)]
    model.tube_bm(sb, pts, 0.024, 6)
    bmesh.ops.create_uvsphere(sb, u_segments=10, v_segments=6, radius=0.04,
                              matrix=Matrix.Translation((0.0, -0.08, 0.72)))
    obj("door_iron", sb, iron, col)


def errand_roll(col):
    """Hester's errand list: the writ roll, tied with green, laid across behind the head."""
    TITLE_RIBBON["errands"] = (0.18, 0.62, 0.2)
    title_writ(col, "errands")
    for o in col.objects:
        if o.name.startswith("crest_writ"):
            o.scale = (1.25, 1.25, 1.25)


def ghost_bm(rad):
    bm = bmesh.new()
    rings = []
    n = 18
    for i in range(10):
        t = i / 9
        z = 0.9 * rad - t * 2.2 * rad
        rr = rad * (math.sin(min(1.0, t * 2.2) * math.pi / 2) if t < 0.45 else 1.0 + 0.25 * (t - 0.45))
        row = []
        for k in range(n):
            a = k / n * TAU
            wave = 0.18 * rad * math.sin(a * 4) * max(0.0, t - 0.8) * 5
            row.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z + wave)))
        rings.append(row)
    top = bm.verts.new((0.0, 0.0, 0.92 * rad))
    for k in range(n):
        bm.faces.new((top, rings[0][(k + 1) % n], rings[0][k]))
    for i in range(9):
        for k in range(n):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k]))
    return bm


def leaping_ghosts(col):
    """Three little sheet-ghosts leaping out round the head: the Boo! in three towns."""
    sheet = principled("GhostSheet", (0.92, 0.93, 1.0), rough=0.6, emit=(0.6, 0.65, 1.0), strength=0.6)
    eye = principled("GhostEye", (0.02, 0.02, 0.03), rough=0.9)
    for i, (x, z, rad, tilt) in enumerate(((-0.6, 0.38, 0.17, 0.35), (0.62, 0.4, 0.16, -0.35), (0.0, -0.66, 0.15, 0.0))):
        g = obj("ghost_%d" % i, ghost_bm(rad), sheet, col)
        g.location = (x, -0.7, z)
        g.rotation_euler = (0.0, tilt, 0.0)
        eb = bmesh.new()
        for ex in (-0.35, 0.35):
            bmesh.ops.create_uvsphere(eb, u_segments=10, v_segments=6, radius=rad * 0.16,
                                      matrix=Matrix.Translation((ex * rad, -0.92 * rad, 0.35 * rad)))
        bmesh.ops.create_uvsphere(eb, u_segments=10, v_segments=6, radius=rad * 0.22,
                                  matrix=Matrix.Translation((0.0, -0.92 * rad, -0.05 * rad)))
        e = obj("ghost_eyes_%d" % i, eb, eye, col)
        e.location = g.location
        e.rotation_euler = g.rotation_euler


def lit_crown(col):
    """The Gourdsworn's crown: four small lit pumpkins round the head, the scythe behind."""
    thatchgrin_scythe(col)
    skin = principled("CrownSkin", (0.8, 0.28, 0.03), rough=0.45, emit=(1.0, 0.38, 0.05), strength=0.25)
    stem = principled("CrownStem", (0.16, 0.12, 0.05), rough=0.8)
    for i, (x, z, rad) in enumerate(((-0.62, 0.36, 0.13), (0.62, 0.36, 0.13), (-0.5, -0.56, 0.14), (0.5, -0.56, 0.14))):
        bm = model.pumpkin_bm("crest-crown-%d" % i, rad, rad * 1.6, 8, 24, 12)
        o = obj("crown_pumpkin_%d" % i, bm, skin, col)
        o.location = (x, -0.75, z)
        sbm = bmesh.new()
        model.tube_bm(sbm, [(0.0, 0.0, 0.0), (0.01, 0.0, rad * 0.45)], rad * 0.14, 6)
        st = obj("crown_stem_%d" % i, sbm, stem, col)
        st.location = (x, -0.75, z + rad * 0.6)


def build(col):
    gold = principled("Gold", (1.0, 0.72, 0.3), rough=0.3, metal=1.0)
    gold_dark = principled("GoldDark", (0.9, 0.6, 0.24), rough=0.36, metal=1.0)
    band = principled("RimBand", (0.04, 0.05, 0.11), rough=0.55, metal=0.3)
    field = field_material()
    if SUBJECT[0] == "thatchgrin":
        # an ember field rather than the night violet: his burning stubble
        ramp = next(n for n in field.node_tree.nodes if n.type == "VALTORGB")
        tones = [(0.03, 0.008, 0.004, 1), (0.3, 0.07, 0.015, 1), (0.1, 0.025, 0.01, 1)]
        for el, tone in zip(ramp.color_ramp.elements, tones):
            el.color = tone
        b = next(n for n in field.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        field.node_tree.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.6
    if SUBJECT[0] in TITLE_FIELDS:
        ramp = next(n for n in field.node_tree.nodes if n.type == "VALTORGB")
        for el, tone in zip(ramp.color_ramp.elements, TITLE_FIELDS[SUBJECT[0]]):
            el.color = tone
        b = next(n for n in field.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        field.node_tree.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.3
    if SUBJECT[0] == "pumpkin_hunter":
        ramp = next(n for n in field.node_tree.nodes if n.type == "VALTORGB")
        for el, tone in zip(ramp.color_ramp.elements, PUMPKIN_HUNTER_FIELD):
            el.color = tone
        b = next(n for n in field.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        field.node_tree.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.3
    if SUBJECT[0] in ROUND12_FIELDS:
        ramp = next(n for n in field.node_tree.nodes if n.type == "VALTORGB")
        for el, tone in zip(ramp.color_ramp.elements, ROUND12_FIELDS[SUBJECT[0]]):
            el.color = tone
        b = next(n for n in field.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        field.node_tree.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.3
    obj("field", disc(0.92, 0.05, 0.06), field, col)
    if SUBJECT[0] == "doorsteps":
        door_behind(col)
    if SUBJECT[0] == "errands":
        errand_roll(col)
    if SUBJECT[0] == "frights":
        leaping_ghosts(col)
    if SUBJECT[0] == "eve_complete":
        lit_crown(col)
    if SUBJECT[0] == "pumpkin_hunter":
        hunter_row(col)
    if SUBJECT[0] == "thatchgrin":
        thatchgrin_scythe(col)
    if SUBJECT[0] in TITLE_FIELDS:
        title_writ(col, SUBJECT[0])
    gbm = bmesh.new()
    bmesh.ops.create_circle(gbm, cap_ends=True, segments=64, radius=0.7,
                            matrix=Matrix.Translation((0, 0.025, -0.02)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    obj("bloom", gbm, bloom_material(), col)
    # the frame: a dark enamel band between two gilded rings, studs, four points
    bm = bmesh.new()
    ring(bm, 0.93, 0.045, -0.02)
    ring(bm, 1.07, 0.05, -0.02)
    obj("frame_gold", bm, gold, col)
    if SUBJECT[0] == "thatchgrin":
        band.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.035, 0.01, 1)
    if SUBJECT[0] == "pumpkin_hunter":
        tone = PUMPKIN_HUNTER_FIELD[1]
        band.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
            tone[0] * 0.55, tone[1] * 0.55, tone[2] * 0.55, 1)
    if SUBJECT[0] in ROUND12_FIELDS:
        tone = ROUND12_FIELDS[SUBJECT[0]][1]
        band.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
            tone[0] * 0.55, tone[1] * 0.55, tone[2] * 0.55, 1)
    if SUBJECT[0] in TITLE_FIELDS:
        tone = TITLE_FIELDS[SUBJECT[0]][1]
        band.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
            tone[0] * 0.55, tone[1] * 0.55, tone[2] * 0.55, 1)
    obj("frame_band", disc(1.03, 0.06, 0.02), band, col)
    bm = bmesh.new()
    for i in range(16):
        a = i / 16 * TAU + TAU / 32
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.026,
                                  matrix=Matrix.Translation((math.cos(a), -0.04, math.sin(a))))
    obj("studs", bm, gold, col)
    bm = bmesh.new()
    for i in range(4):
        a = i / 4 * TAU + math.pi / 2
        d = Vector((math.cos(a), 0.0, math.sin(a)))
        side = Vector((-math.sin(a), 0.0, math.cos(a)))
        tip = bm.verts.new(d * 1.3 + Vector((0, -0.05, 0)))
        base_in = bm.verts.new(d * 1.0 + Vector((0, -0.02, 0)))
        left = bm.verts.new(d * 1.08 + side * 0.09)
        right = bm.verts.new(d * 1.08 - side * 0.09)
        top = bm.verts.new(d * 1.09 + Vector((0, -0.15, 0)))
        for a1, b1 in ((left, top), (top, right)):
            bm.faces.new((tip, a1, b1))
            bm.faces.new((base_in, b1, a1))
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.045,
                                  matrix=Matrix.Translation(d * 1.1 + Vector((0, -0.12, 0))))
    obj("spikes", bm, gold, col, smooth=False)
    # gilt filigree: a vine of curls round the lower field, both sides
    bm = bmesh.new()
    for sgn in (-1, 1):
        for k, (cx, cz, r, a0, turns) in enumerate(
            ((0.5, -0.45, 0.15, 0.0, 1.4), (0.68, 0.02, 0.11, 2.0, 1.3), (0.44, 0.5, 0.1, 3.5, 1.2))
        ):
            pts = []
            n = 40
            for i in range(n + 1):
                t = i / n
                a = a0 + t * turns * TAU
                rr = r * (1.0 - 0.75 * t)
                pts.append((sgn * (cx + math.cos(a) * rr), -0.01, cz + math.sin(a) * rr))
            model.tube_bm(bm, pts, 0.014 if k == 0 else 0.012, 6)
        pts = []
        for i in range(30):
            t = i / 29
            a = -1.35 + t * 2.6
            pts.append((sgn * math.cos(a) * 0.74, -0.01, math.sin(a) * 0.74))
        model.tube_bm(bm, pts, 0.011, 6)
    obj("filigree", bm, gold_dark, col)
    # a fan of autumn leaves behind the head
    lbm = bmesh.new()
    # a wreath under and round the head: low leaves broad, the upper ones peeking
    specs = [(3.55, 0.34, 0), (-0.41, 0.34, 1), (2.85, 0.3, 2), (0.29, 0.3, 3), (4.2, 0.3, 1), (-1.06, 0.3, 0),
             (2.25, 0.24, 3), (0.9, 0.24, 2)]
    for i, (a, size, c) in enumerate(specs):
        leaf = model.leaf_bm("crest-leaf-%d" % i, size, (0, 0, 0), 0.0, 0.04)
        m = (Matrix.Translation((math.cos(a) * 0.44, -0.004 * i, math.sin(a) * 0.4 - 0.04))
             @ Matrix.Rotation(-math.pi / 2, 4, "X") @ Matrix.Rotation(a - math.pi / 2, 4, "Z"))
        vmap = {v: lbm.verts.new(m @ v.co) for v in leaf.verts}
        for f in leaf.faces:
            nf = lbm.faces.new([vmap[v] for v in f.verts])
            nf.material_index = c
        leaf.free()
    leaves = obj("leaves", lbm, principled("LeafA", (0.85, 0.28, 0.03), rough=0.55), col)
    for name, rgb in (("LeafB", (0.62, 0.1, 0.04)), ("LeafC", (0.95, 0.6, 0.08)), ("LeafD", (0.5, 0.2, 0.05))):
        leaves.data.materials.append(principled(name, rgb, rough=0.55))
    head_col = bpy.data.collections.new("head")
    bpy.context.scene.collection.children.link(head_col)
    _, (head,) = model.build_head(head_col)
    head.parent = None
    head.scale = (2.0, 2.0, 2.0)
    head.location = (0.0, -0.45, -0.07)
    head.rotation_euler = (0.1, 0.0, 0.16)
    # a candle core inside, so every cut of the face glows, eyes included
    cbm = bmesh.new()
    bmesh.ops.create_icosphere(cbm, subdivisions=2, radius=0.3, matrix=Matrix.Translation((0.0, -0.4, -0.02)))
    obj("candle", cbm, principled("Candle", (1.0, 0.8, 0.4), emit=(1.0, 0.62, 0.2), strength=14.0), col)
    for mt in head.data.materials:
        b = next((n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b is None:
            continue
        if mt.name in ("GourdFlesh", "GourdInner", "GourdGlow"):
            b.inputs["Emission Strength"].default_value = 9.0
        elif mt.name == "GourdLitSkin":
            b.inputs["Emission Strength"].default_value = 0.12
    return head


def setup(out):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    looks = [i.identifier for i in scene.view_settings.bl_rna.properties["look"].enum_items]
    scene.view_settings.look = next((lk for lk in looks if "Medium High Contrast" in lk), "None")
    scene.view_settings.exposure = -0.2
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.06, 0.05, 0.07, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8

    def area(name, energy, size, loc, color=(1.0, 1.0, 1.0)):
        o = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
        o.data.energy = energy
        o.data.size = size
        o.data.color = color
        o.location = loc
        o.rotation_euler = (Vector((0, 0, 0)) - o.location).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(o)

    area("key", 320, 2.5, (-2.2, -3.2, 2.6))
    area("fill", 90, 3.0, (2.6, -3.0, -0.6), (0.75, 0.8, 1.0))
    area("top", 120, 2.0, (0.4, -1.0, 3.2), (1.0, 0.85, 0.6))
    warm = bpy.data.objects.new("warm", bpy.data.lights.new("warm", "POINT"))
    warm.data.energy = 30
    warm.data.color = (1.0, 0.5, 0.15)
    warm.location = (0.0, -1.1, -0.35)
    scene.collection.objects.link(warm)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.95
    cam.location = (0.0, -6.0, 0.0)
    cam.rotation_euler = (math.pi / 2, 0.0, 0.0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    name = ROUND12_DEEDS.get(SUBJECT[0]) or TITLE_DEEDS.get(SUBJECT[0]) or ("feat_pumpkin_hunter" if SUBJECT[0] == "pumpkin_hunter" else None) or (
        "feat_old_thatchgrin" if SUBJECT[0] == "thatchgrin" else "feat_gourdlight_guise"
    )
    scene.render.filepath = os.path.join(out, name + ".png")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1]
    if "--subject" in argv:
        SUBJECT[0] = argv[argv.index("--subject") + 1]
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = bpy.data.collections.new("Crest")
    bpy.context.scene.collection.children.link(col)
    build(col)
    setup(out)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
