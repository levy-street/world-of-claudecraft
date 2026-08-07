"""Warden Hale's memorial: bronze warden (KayKit knight rig, re-posed) on a
European-style stone column with the seal-bearers' names engraved on the dado.

Deterministic: same inputs -> same GLB. No randomness, no time.
Front faces +Z (matches the props.ts contract for wardenHaleStatue).
"""

import bpy
import bmesh
import json
import math
import os
from mathutils import Matrix, Vector

# scripts/assets/warden_hale_statue/model.py -> repo root is three levels up.
# `blender --python` leaves __file__ pointing at this script, so the factory
# stays runnable from any checkout without a machine-specific path.
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KNIGHT = f"{REPO}/public/models/chars/players/knight.glb"
SWORD = f"{REPO}/public/models/weapons/sword_b.glb"
OUT = os.environ["STATUE_OUT"]

# --- proportions (yards) -------------------------------------------------
# A memorial column reads as one only when the shaft clearly outmeasures the
# figure. Steps + dado + shaft + capital carry the figure to ~5.0, and the
# 2.2 figure tops out near 7.2 overall.
STEP_H = 0.16
STEP_SIZES = [(2.80, 2.80), (2.52, 2.52), (2.26, 2.26)]
DADO_W, DADO_D, DADO_H = 1.90, 1.90, 1.40      # the name block
PLINTH_CAP_H = 0.14
SHAFT_H = 1.80
SHAFT_R_LO, SHAFT_R_HI = 0.68, 0.58            # entasis (slight taper)
SHAFT_SIDES = 24
FLUTES = 18
FLUTE_DEPTH = 0.055                            # shallow flutes vanish at range
CAPITAL_H = 0.36
ABACUS_W, ABACUS_H = 1.60, 0.18
# The figure has to read from the town pad ~4yd below, so it takes a larger
# share of the silhouette than a real Trafalgar-style column would give it.
FIGURE_H = 3.00

# The stone carries the dedication only. The roll of seal-bearers moved to the
# plaque you get for interacting with the memorial, which is where a Roll of
# Honour belongs: legible, scrollable, and translatable, none of which baked
# lettering on a 7yd column can be.
DEDICATION = "WARDEN HALE"

TAU = math.tau


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, metallic, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    return m


def new_mesh(name, verts, faces, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    bpy.context.collection.objects.link(ob)
    return ob


def box(name, w, d, h, z, material, taper=1.0):
    """Axis-aligned box, optionally tapered toward the top."""
    hw, hd = w / 2, d / 2
    tw, td = hw * taper, hd * taper
    v = [
        (-hw, -hd, z), (hw, -hd, z), (hw, hd, z), (-hw, hd, z),
        (-tw, -td, z + h), (tw, -td, z + h), (tw, td, z + h), (-tw, td, z + h),
    ]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return new_mesh(name, v, f, material)


def fluted_shaft(name, z0, h, r_lo, r_hi, sides, flutes, material, depth=0.030):
    """Tapered drum with shallow vertical flutes, the classical shaft read."""
    verts, faces = [], []
    rings = 6
    for ri in range(rings + 1):
        t = ri / rings
        z = z0 + h * t
        # entasis: a slight convex swell rather than a straight cone
        swell = math.sin(t * math.pi) * 0.016
        r_base = r_lo + (r_hi - r_lo) * t + swell
        for si in range(sides):
            a = TAU * si / sides
            # flute scallops, deepest between the reeds
            f = math.cos(a * flutes) * 0.5 + 0.5
            r = r_base - f * depth
            verts.append((math.cos(a) * r, math.sin(a) * r, z))
    for ri in range(rings):
        for si in range(sides):
            a0 = ri * sides + si
            a1 = ri * sides + (si + 1) % sides
            b0, b1 = a0 + sides, a1 + sides
            faces.append((a0, a1, b1, b0))
    # caps
    base_c = len(verts)
    verts.append((0, 0, z0))
    top_c = len(verts)
    verts.append((0, 0, z0 + h))
    for si in range(sides):
        faces.append((base_c, (si + 1) % sides, si))
        off = rings * sides
        faces.append((top_c, off + si, off + (si + 1) % sides))
    return new_mesh(name, verts, faces, material)


def torus_molding(name, z, r, tube, material, seg=24, ring=8):
    verts, faces = [], []
    for i in range(seg):
        a = TAU * i / seg
        for j in range(ring):
            b = TAU * j / ring
            rr = r + math.cos(b) * tube
            verts.append((math.cos(a) * rr, math.sin(a) * rr, z + math.sin(b) * tube))
    for i in range(seg):
        for j in range(ring):
            a0 = i * ring + j
            a1 = i * ring + (j + 1) % ring
            b0 = ((i + 1) % seg) * ring + j
            b1 = ((i + 1) % seg) * ring + (j + 1) % ring
            faces.append((a0, a1, b1, b0))
    return new_mesh(name, verts, faces, material)


# ------------------------------------------------------------------ figure
def load_figure(bronze):
    """Import the knight, drop the animation, re-pose for the memorial, rework
    the helmet, and give him a planted sword. Returns the posed objects."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=KNIGHT)
    new = [o for o in bpy.data.objects if o not in before]

    rig = next(o for o in new if o.type == "ARMATURE")
    meshes = [o for o in new if o.type == "MESH"]

    # the KayKit export carries a stray unparented helper sphere
    for o in list(meshes):
        if not o.vertex_groups:
            bpy.data.objects.remove(o, do_unlink=True)
            meshes.remove(o)

    # static memorial: no clips travel into the GLB
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    if rig.animation_data:
        rig.animation_data_clear()

    # ---- pose: stood at rest, both hands folded over a planted sword ----
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    P = {b.name: b for b in rig.pose.bones}
    for b in P.values():
        b.rotation_mode = "XYZ"

    def rot(bone, x=0.0, y=0.0, z=0.0):
        P[bone].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))

    # arms down and drawn in, forearms angled so the hands meet at the belt
    rot("upperarm.l", 6, 0, -62)
    rot("upperarm.r", 6, 0, 62)
    rot("lowerarm.l", -8, 26, -30)
    rot("lowerarm.r", -8, -26, 30)
    rot("wrist.l", 0, 0, -10)
    rot("wrist.r", 0, 0, 10)
    rot("hand.l", 0, 18, 0)
    rot("hand.r", 0, -18, 0)
    # weight settled, chin level, a shade of contrapposto
    rot("upperleg.l", 0, 0, 3)
    rot("upperleg.r", 0, 0, -5)
    rot("lowerleg.r", 2, 0, 0)
    rot("spine", -3, 0, 0)
    rot("chest", 2, 0, 0)
    rot("head", 4, 0, 0)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()   # settle the posed bone matrices before we read them

    # Where the hands actually ended up. The KayKit rig carries dedicated
    # `handslot.*` weapon-attach bones, so the grip anchor is measured off the
    # POSE rather than guessed: hand-placing the sword is what left it floating
    # a few inches clear of the palms in the first pass.
    slots = [rig.matrix_world @ P[n].head for n in ("handslot.l", "handslot.r") if n in P]
    grip_anchor = sum(slots, Vector((0.0, 0.0, 0.0))) / len(slots) if slots else None

    # ---- helmet rework: face bared, fore-and-aft crest on the skull ----
    helm = next((o for o in meshes if "Helmet" in o.name and "Visor" not in o.name), None)
    visor = next((o for o in meshes if "Visor" in o.name), None)
    if visor:
        # A memorial shows the face. The visor's origin sits at the model root,
        # so rotating it pivots around the feet; removing it is both correct
        # and the only stable option.
        meshes.remove(visor)
        bpy.data.objects.remove(visor, do_unlink=True)

    crest = None
    if helm:
        # a plume ridge, the detail that separates a warden's helm from the
        # stock knight bucket. Sized off the helmet so it scales with the model.
        bb = [helm.matrix_world @ Vector(c) for c in helm.bound_box]
        cx = sum(p.x for p in bb) / 8
        cy = sum(p.y for p in bb) / 8
        top = max(p.z for p in bb)
        length = max(p.y for p in bb) - min(p.y for p in bb)
        me = bpy.data.meshes.new("Warden_Crest")
        bm = bmesh.new()
        half = length * 0.42
        thick = length * 0.078          # a thin fin reads as a shard, not a plume
        rise = length * 0.20
        # A smooth comb, not a shard: sample a sine arc so the silhouette reads
        # as one cast ridge, with the crown pushed slightly aft of centre.
        steps = 11
        prof = []
        for i in range(steps):
            t = i / (steps - 1)
            y = -half + 2 * half * t
            arc = math.sin(t * math.pi) ** 0.75
            skew = 1.0 - 0.18 * (t - 0.5)
            prof.append((y, rise * arc * skew))
        ring = []
        for y, dz in prof:
            ring.append((bm.verts.new((-thick, y, dz)), bm.verts.new((thick, y, dz))))
        bm.verts.ensure_lookup_table()
        for i in range(len(ring) - 1):
            (l0, r0), (l1, r1) = ring[i], ring[i + 1]
            bm.faces.new((l0, l1, r1, r0))
        sink = -rise * 0.55          # buried far enough to read as one casting
        base = []
        for y, _ in prof:
            base.append((bm.verts.new((-thick, y, sink)), bm.verts.new((thick, y, sink))))
        for i in range(len(base) - 1):
            (l0, r0), (l1, r1) = base[i], base[i + 1]
            bm.faces.new((r0, r1, l1, l0))
        for i in range(len(prof) - 1):
            bm.faces.new((ring[i][0], base[i][0], base[i + 1][0], ring[i + 1][0]))
            bm.faces.new((ring[i + 1][1], base[i + 1][1], base[i][1], ring[i][1]))
        bm.faces.new((ring[0][0], ring[0][1], base[0][1], base[0][0]))
        bm.faces.new((base[-1][0], base[-1][1], ring[-1][1], ring[-1][0]))
        bm.to_mesh(me)
        bm.free()
        crest = bpy.data.objects.new("Warden_Crest", me)
        bpy.context.collection.objects.link(crest)
        crest.location = (cx, cy, top - rise * 0.30)
        meshes.append(crest)

    # ---- sword, planted point-down, grip passing through both palms ----
    # The knight faces -Y (cape at +Y, brow at -Y), so the blade stands clear of
    # the torso on the -Y side. Everything else is DERIVED from `grip_anchor`
    # above: the scale is whatever makes the tip reach the ground from the hands,
    # so the palms and the grip cannot drift apart when the pose is retuned.
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=SWORD)
    sword_meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in sword_meshes for c in o.bound_box]
    z_hi = max(p.z for p in pts)              # source-space tip (blade runs +Z)
    TIP_CLEARANCE = 0.03                      # blade bites the plinth, not the air
    if grip_anchor is not None:
        grip_z = grip_anchor.z
        grip_y = grip_anchor.y - 0.13         # forward of the knuckles, not inside them
    else:
        grip_z, grip_y = 1.05, -0.40
    # tip lands at TIP_CLEARANCE when the blade below the grip is exactly that long
    s = max((grip_z - TIP_CLEARANCE) / z_hi, 0.20)
    # The importer already carries a Y-up -> Z-up rotation on these objects, so
    # ASSIGNING rotation_euler would throw that away and lay the blade flat.
    # Compose the flip onto the existing world matrix instead.
    flip = Matrix.Rotation(math.pi, 4, "X")
    scale = Matrix.Diagonal((s * 1.05, s * 1.05, s, 1.0))
    place = Matrix.Translation((0.0, grip_y, grip_z))
    for o in sword_meshes:
        o.matrix_world = place @ flip @ scale @ o.matrix_world
        for slot in range(len(o.data.materials)):
            o.data.materials[slot] = bronze
    meshes.extend(sword_meshes)

    # bake the pose into the meshes so the GLB ships static, no armature
    for o in meshes:
        if o.parent == rig:
            for m in o.modifiers:
                if m.type == "ARMATURE":
                    bpy.context.view_layer.objects.active = o
                    bpy.ops.object.modifier_apply(modifier=m.name)
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw               # unparenting must not drop the transform

    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(bronze)

    bpy.data.objects.remove(rig, do_unlink=True)
    return meshes


def engrave(body, face_y, centre_z, size, material):
    """Cut the dedication into the dado's front face.

    Text is real geometry (nothing extra to ship), kept cheap: no bevel, low
    curve resolution. A text object rotated 90deg about X faces -Y, which is
    the memorial's front (-Y in Blender exports as +Z in glTF), so the letters
    have to sit on the -Y face or they point into the stone.
    """
    cu = bpy.data.curves.new("dedication", type="FONT")
    cu.body = body
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.resolution_u = 1              # keep the tri budget sane
    cu.extrude = 0.014
    ob = bpy.data.objects.new("Dedication", cu)
    bpy.context.collection.objects.link(ob)
    ob.rotation_euler = (math.radians(90), 0, 0)
    ob.location = (0.0, face_y, centre_z)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    ob.select_set(False)
    ob.data.materials.clear()
    ob.data.materials.append(material)
    return [ob]


def build():
    clear()
    stone = mat("memorial_stone", (0.615, 0.600, 0.565), 0.0, 0.82)
    stone_dk = mat("memorial_engraving", (0.235, 0.225, 0.205), 0.0, 0.90)
    bronze = mat("memorial_bronze", (0.286, 0.180, 0.086), 1.0, 0.44)

    parts = []
    z = 0.0
    for i, (w, d) in enumerate(STEP_SIZES):
        parts.append(box(f"Step_{i}", w, d, STEP_H, z, stone))
        z += STEP_H

    dado_z = z
    parts.append(box("Dado", DADO_W, DADO_D, DADO_H, z, stone))
    z += DADO_H
    parts.append(box("DadoCap", DADO_W + 0.16, DADO_D + 0.16, PLINTH_CAP_H, z, stone))
    z += PLINTH_CAP_H
    parts.append(torus_molding("BaseMold", z + 0.05, SHAFT_R_LO + 0.10, 0.085, stone))
    z += 0.12

    shaft_z = z
    parts.append(
        fluted_shaft("Shaft", z, SHAFT_H, SHAFT_R_LO, SHAFT_R_HI, SHAFT_SIDES, FLUTES, stone, FLUTE_DEPTH)
    )
    z += SHAFT_H

    parts.append(torus_molding("NeckMold", z, SHAFT_R_HI + 0.045, 0.062, stone))
    parts.append(box("Echinus", SHAFT_R_HI * 2 + 0.20, SHAFT_R_HI * 2 + 0.20, CAPITAL_H, z, stone, taper=1.30))
    z += CAPITAL_H
    parts.append(box("Abacus", ABACUS_W, ABACUS_W, ABACUS_H, z, stone))
    z += ABACUS_H

    # dedication on the memorial's front face (-Y in Blender == +Z in glTF),
    # sat high on the dado so the stone below it reads as deliberately blank
    parts += engrave(DEDICATION, -DADO_D / 2, dado_z + DADO_H * 0.70, 0.215, stone_dk)

    # figure on the abacus
    fig = load_figure(bronze)
    pts = [o.matrix_world @ Vector(c) for o in fig for c in o.bound_box]
    fmin = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    fmax = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    scale = FIGURE_H / (fmax.z - fmin.z)
    cx = (fmin.x + fmax.x) / 2
    cy = (fmin.y + fmax.y) / 2
    for o in fig:
        o.scale = [v * scale for v in o.scale]
        o.location = (
            (o.location.x - cx) * scale,
            (o.location.y - cy) * scale,
            (o.location.z - fmin.z) * scale + z,
        )

    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    return parts + fig


def measure():
    mn = [1e9] * 3
    mx = [-1e9] * 3
    tris = 0
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    return {
        "tris": tris,
        "min": [round(v, 3) for v in mn],
        "max": [round(v, 3) for v in mx],
        "size": [round(mx[i] - mn[i], 3) for i in range(3)],
        "radius_xz": round(max(abs(mn[0]), abs(mx[0]), abs(mn[1]), abs(mx[1])), 3),
    }


build()

# every material here is a flat Principled colour, so the knight/sword source
# textures are dead weight the exporter would otherwise embed.
for img in list(bpy.data.images):
    bpy.data.images.remove(img)

stats = measure()
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True)
stats["out"] = OUT
stats["bytes"] = os.path.getsize(OUT)
result = stats
print("STATS " + json.dumps(stats))
