"""Machinery for building The Last Bell's cast onto the shipped KayKit rigs.

The recipes themselves live in `figures.py` and their copy in `cast.py`; this
module is only the shared apparatus: load a base body, repaint its palette grid,
move a face off one cell onto another, mount held props, measure, export.

Design rules the cast holds itself to:

  * ONE material for a figure's BODY. Every bespoke part UVs into the same
    palette grid, so a crew member still merges to one draw at runtime. Held
    props are separate models on purpose, exactly as the game attaches them.
  * The palette is the characterisation. Salt-scoured iron, bell bronze (the
    Vigil's metal: the Bellheart, the bell, Hale's bronze), oiled leather,
    star-glass (the island's own material), and each defender's sim entity
    colour used literally as their cloth.
  * One authored detail per figure that carries their arc, readable at
    gameplay distance.

Lore anchors: `docs/design/last-bell-campaign.html` (source of truth),
`docs/design/farshore-last-bell-spec.md` sections 4 and 5, and the entity colours
in `src/sim/content/farshore.ts` / `last_bell_campaign.ts`.

Deterministic: same inputs -> same GLB. No randomness, no time.
"""

import bpy
import os
import re

import atlas
import parts
from atlas import ramp

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PLAYERS = f"{REPO}/public/models/chars/players"
ENEMIES = f"{REPO}/public/models/chars/enemies"
CREATURES = f"{REPO}/public/models/creatures"


def base_path(glb):
    """Resolve a base body. The crew come off `chars/players`, the break-spawned
    off `chars/enemies` (the KayKit Skeletons pack), and both share the same rig
    and the same swatch-grid atlas, so one loader serves both."""
    for root in (PLAYERS, ENEMIES):
        candidate = f"{root}/{glb}"
        if os.path.exists(candidate):
            return candidate
    raise FileNotFoundError(f"no base body named {glb}")

ADDR = re.compile(r"^r[0-3]c[0-7]$")

# What Gullhaven itself is made of. Individual recipes override cloth, hair, skin.
IRON = ramp(0x9BA7A3, 0x4D5553)        # plate scoured by salt air
IRON_DARK = ramp(0x616B69, 0x353C3B)
BRONZE = ramp(0x9C7437, 0x462F13)      # bell bronze: aged, never jewellery gold
LEATHER = ramp(0x63482F, 0x33241A)     # oiled against the weather
LEATHER_PALE = ramp(0x9C7A4E, 0x53381F)
BOOT = ramp(0x3F4548, 0x1F2325)
GLASS = ramp(0xA9DCEE, 0x35708F)       # star-glass, washed up after storms
VERDIGRIS = ramp(0x6F9C86, 0x2F4A40)
CANVAS = ramp(0xBFAE8E, 0x6E6046)      # sailcloth and bandage linen
TAR = ramp(0x2A2724, 0x121110)         # tarred rope and oilskin
BRASS = ramp(0xD8B45C, 0x7A5F22)
LINEN = ramp(0xDFE3E2, 0x9AA3A4)
BONE = ramp(0xE4D9C0, 0x9E9078)        # scrimshaw, whale ivory, old paper


def base_palette(**over):
    """The shared island palette. Keys a given rig does not define are ignored
    by `atlas.paint`, so one definition serves every base body."""
    pal = {
        "skin": ramp(0xDBA884, 0x9A6E4E),
        "hair": ramp(0x6B5540, 0x3A2C20),
        "eyes": ramp(0x1A2125, 0x000000),
        "plate": IRON, "plate_dark": IRON_DARK,
        "leather": LEATHER, "trim": BRONZE,
        "cloth": ramp(0x8A4B2B, 0x40200F),
        "cape": ramp(0x8A4B2B, 0x40200F),
        "white": LINEN, "steel_b": ramp(0x7D8887, 0x424947), "gold": BRASS,
        "boots": BOOT, "gloves": LEATHER, "trousers": ramp(0x4C4438, 0x272219),
        "hat": ramp(0x4A5A6A, 0x232B33), "fur": ramp(0x6E5B45, 0x362C21),
        "wrap": CANVAS, "hood": ramp(0x53616B, 0x272E33),
        "body": ramp(0x6B6B3A, 0x33331A), "pack": LEATHER_PALE,
        "pack_dark": LEATHER, "accent": LEATHER_PALE,
        "spare_a": LEATHER_PALE, "spare_b": CANVAS, "spare_c": LEATHER, "spare_d": TAR,
        "glass": GLASS, "bronze": BRONZE, "verdigris": VERDIGRIS,
        "canvas": CANVAS, "rust": ramp(0x8A4B2B, 0x40200F), "tar": TAR,
        "brass": BRASS, "bone": BONE,
    }
    pal.update(over)
    return pal


# --------------------------------------------------------------------- loading
def wipe():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures,
                 bpy.data.materials, bpy.data.actions, bpy.data.images,
                 bpy.data.curves, bpy.data.collections, bpy.data.lights,
                 bpy.data.cameras):
        for item in list(coll):
            try:
                coll.remove(item)
            except Exception:
                pass


def seed_context():
    """The glTF importer reads `bpy.context.object`, which is unset in a freshly
    emptied file. Give the view layer something active first."""
    seed = bpy.data.objects.new("ctx_seed", None)
    bpy.context.scene.collection.objects.link(seed)
    bpy.context.view_layer.objects.active = seed
    return seed


def load_base(glb, hide=()):
    """Import a KayKit body, drop its stray helper and the hidden accessories,
    and make that rig's palette layout the active one."""
    atlas.use_slots(atlas.SLOT_MAPS[glb])
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=base_path(glb))
    new = [o for o in bpy.data.objects if o not in before]
    rig = next(o for o in new if o.type == "ARMATURE")
    meshes = [o for o in new if o.type == "MESH"]
    for o in list(meshes):
        # the KayKit export carries an unparented helper sphere
        if not o.vertex_groups or o.name.split(".")[0] in hide:
            meshes.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    # author and preview against bind space; the clips still ship
    rig.data.pose_position = "REST"
    if rig.animation_data:
        rig.animation_data.action = None
    return rig, meshes


def load_creature(glb, hide=()):
    """Import a creature body. Creature GLBs carry BAKED textures rather than a
    palette grid, so they are re-coloured at runtime by the entity tint the sim
    already gives them; nothing here repaints them."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f"{CREATURES}/{glb}")
    new = [o for o in bpy.data.objects if o not in before]
    rig = next((o for o in new if o.type == "ARMATURE"), None)
    # These packs ship a stray unparented helper sphere ("Icosphere") alongside the
    # body; it has no skin weights and it wrecks any bounding-box fit.
    meshes = [o for o in new if o.type == "MESH"
              and o.name.split(".")[0] not in hide
              and not o.name.startswith("Icosphere")]
    for o in [o for o in new if o.type == "MESH" and o not in meshes]:
        bpy.data.objects.remove(o, do_unlink=True)
    if rig:
        rig.data.pose_position = "REST"
        if rig.animation_data:
            rig.animation_data.action = None
    return rig, meshes


def repaint(meshes, name, palette, size=512):
    """Swap the shipped palette grid for a repainted one, in place."""
    img = bpy.data.images.new(f"{name}_atlas", size, size, alpha=False)
    # Colourspace FIRST: changing it on a generated image re-runs the generator
    # and would wipe the painted pixels back to black.
    img.colorspace_settings.name = "sRGB"
    slots = atlas.active_slots()
    usable = {k: v for k, v in palette.items() if k in slots or ADDR.match(k)}
    atlas.paint(img, usable, slots)
    img.update()
    img.pack()                       # so the glTF exporter embeds real pixels
    mats = {m for o in meshes for m in o.data.materials if m}
    body_mat = None
    for mat in mats:
        mat.name = name if body_mat is None else f"{name}_{mat.name}"
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE":
                node.image = img
                node.interpolation = "Closest"
        body_mat = body_mat or mat
    return img, body_mat


def reuv(obj, from_slot, to_slot, shade_t=0.3):
    """Move the faces sampling one palette cell onto another.

    Used where KayKit shares a cell between two surfaces this cast wants
    separated: the knight's chest boss samples the CAPE cell, and Coalfast's boss
    has to be star-glass while his cloak stays warden rust.
    """
    slots = atlas.active_slots()
    src = slots.get(from_slot, from_slot)
    fr, fc = int(src[1]), int(src[3])
    target = atlas.cell_uv(to_slot, shade_t)
    uvl = obj.data.uv_layers.active.data
    moved = 0
    for poly in obj.data.polygons:
        us = [uvl[li].uv for li in poly.loop_indices]
        cu = sum(u[0] for u in us) / len(us)
        cv = sum(u[1] for u in us) / len(us)
        if int(cu * atlas.COLS) == fc and int((1.0 - cv) * atlas.ROWS) == fr:
            for li in poly.loop_indices:
                uvl[li].uv = target
            moved += 1
    return moved


def flat_material(name, color, metallic=0.0, roughness=0.72, emission=None):
    """A plain Principled material for bespoke additions to a CREATURE body,
    which has no palette grid to join."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*atlas.hex_rgb(color), 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*atlas.hex_rgb(emission), 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.4
    return mat


# --------------------------------------------------------------------- weapons
# Grip tunings per prop FAMILY, not per model: every KayKit weapon and tool runs
# its length along +Z with the grip at the origin, so one entry covers a family.
# `rot` is degrees XYZ and `offset` a world nudge off the hand slot. The same
# (url, bone) pairs feed the shipping `VisualDef.attach` entries, so the plates
# and the game cannot show a defender holding different things.
# Every rotation here was chosen by RENDERING the candidates into a real clip and
# looking, not by reasoning about axes: see the Block-pose and Idle-pose grids in
# the review pass. Because the frame is the bone's own, one tuning holds across all
# 22 clips instead of only in the bind pose.
GRIPS = {
    "blade": {"rot": (0, 0, 0), "offset": (0, 0, 0), "scale": 0.62},
    "shield": {"rot": (90, 0, 0), "offset": (0, 0.02, 0), "scale": 0.62},
    "pole": {"rot": (0, 0, 0), "offset": (0, 0, 0), "scale": 0.62},
    # A polearm carried GROUNDED: vertical, head up, butt at the feet, which is the
    # "my line holds the road" silhouette. Solved numerically against the Idle pose
    # (sweep the bone-space rotation, maximise the weapon's verticality with the head
    # up) rather than guessed, then confirmed by looking. The attack clip thrusts it
    # forward, which is correct for a polearm but foreshortens at the book's default
    # camera, so that plate carries its own yaw.
    "polearm": {"rot": (90, 0, -90), "offset": (0, 0, 0), "scale": 0.72},
    "haft": {"rot": (-90, 0, 0), "offset": (0, 0.02, 0), "scale": 0.66},
    "stave": {"rot": (90, 0, 0), "offset": (0, 0.02, 0), "scale": 0.66},
    "hang": {"rot": (0, 0, 0), "offset": (0, 0.02, 0), "scale": 0.62},
    "book": {"rot": (90, 0, 0), "offset": (0, 0.02, 0), "scale": 0.70},
    "tool": {"rot": (-90, 0, 0), "offset": (0, 0.02, 0), "scale": 0.70},
}


def arm(rig, weapons):
    """Mount a figure's held props from its cast `weapons` list."""
    out = []
    for spec in weapons:
        grip = dict(GRIPS[spec["grip"]])
        grip.update(spec.get("tune", {}))
        stem = os.path.basename(spec["url"]).replace(".glb", "")
        out.append(parts.held(f"Prop_{stem}", f"{REPO}/public/models/{spec['url']}",
                              rig, spec["bone"], **grip))
    return out


# ------------------------------------------------------------- export / report
def export(out_path):
    """Write the GLB: rig, skinned meshes, every shipped clip.

    Held props are PRESENTATION only and are dropped here: the game mounts them
    through `VisualDef.attach` so a defender's weapon stays swappable.
    """
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    rig.data.pose_position = "POSE"
    for o in [o for o in bpy.data.objects if o.name.startswith("Prop_")]:
        bpy.data.objects.remove(o, do_unlink=True)
    # Select ONLY the figure: the plate-rendering pass leaves its lamps and camera
    # in the scene, and a whole-scene export would ship them inside the character.
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type in ("MESH", "ARMATURE"):
            o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,          # an applied armature modifier destroys skinning
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_yup=True,
    )
    return out_path


def measure():
    """Report the figure. Body and prop materials are counted separately: the
    one-draw claim is about the BODY, and held props are separate models both
    here and in the game."""
    tris = 0
    mn = [1e9] * 3
    mx = [-1e9] * 3
    body_mats, prop_mats = set(), set()
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        o.data.calc_loop_triangles()
        is_prop = o.name.startswith("Prop_")
        (prop_mats if is_prop else body_mats).update(
            m.name for m in o.data.materials if m)
        if not is_prop:
            tris += len(o.data.loop_triangles)
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    return {"tris": tris,
            "size": [round(mx[i] - mn[i], 3) for i in range(3)],
            "clips": len(bpy.data.actions),
            "materials": sorted(body_mats),
            "prop_materials": sorted(prop_mats)}
