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

BASE BODY ROSTER
----------------
"Which base for this NPC" is the first question every figure asks, and the answer is
in the MESH LIST, because a mesh is what `load_base(hide=...)` can remove and a welded
part is not. Measured off the shipped GLBs, not assumed.

  base              hideable extras            gotcha
  ranger.glb        Cape, Quiver               Ewald.
  knight.glb        Cape, Helmet, HelmetVisor  Marsh, Coalfast. ONE cell covers
                                               cuirass + arms + legs + helmet, so
                                               nothing separates without a re-UV.
  rogue.glb         Cape                       Tam, Nell, Edda.
  rogue_hooded.glb  Cape, Mask                 Ollun. Carries a REAL cowl: half the
                                               head samples the CAPE's cell (r1c1),
                                               so a two-tone costs two palette
                                               entries and no re-UV. Mask is its own
                                               mesh, so it hides or re-cells alone.
  mage.glb          Cape, Hat                  Long loose hair, which reads female at
                                               a glance and hangs past any hood.
  mage_classic.glb  (Cube.NNN names only)      Saul. Reuses MAGE_SLOTS. Meshes are
                                               unnamed primitives, so `hide` is
                                               near-useless; a belt book sits on a
                                               default cell (review 2.15).
  druid.glb         Backpack                   Antlers and leaves are WELDED into
                                               Druid_Head: removing them is a mesh
                                               edit, not a hide. Edda was moved off
                                               this body for exactly that reason.
  barbarian.glb     (none)                     Edda's first pass.
  paladin.glb       Cape, Helmet               Unused. Full plate; no bare head mesh.

Enemy bodies (`chars/enemies`) share the rig and the grid, so the same rules hold.
A base with no `atlas.SLOT_MAPS` entry needs one SURVEYED first: never guess a layout,
and validate a new survey by reproducing a base whose map is already known.

SHIPPING A FIGURE INTO THE GAME
-------------------------------
One command:

    node scripts/assets/last_bell_crew/ship.mjs ollun,coalfast     (or `all`)

It builds and exports raw, optimizes into `public/` (meshopt: a raw export will not load
at runtime), photographs the SHIPPED GLB into the book's plates, rebuilds the page, and
regenerates the media manifest. Run it rather than the steps by hand; the order is
load-bearing and two of the steps have traps (a shared staging dir re-optimizes stale raw
exports over shipped models, and photographing before optimizing puts the book back to
picturing a file that never shipped).

The point of that order: a figure's `fixed` props are BAKED INTO its GLB by `export`
below, and the book renders that same file, so what the page shows is what the game
draws. There is no separate "add it to the game" step that can disagree. If a carry looks
wrong on the page it is wrong in the game; fix it in Blender and re-run.

Clip gate after a base swap: a new base body must still ship every clip name the figure's
ClipMap asks for (`tests/character_clipmaps.test.ts`).
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
NPCS = f"{REPO}/public/models/chars/npcs"


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
    if glb not in atlas.SLOT_MAPS:
        raise SystemExit(
            f"{glb} has no atlas.SLOT_MAPS entry, so its palette cells are unknown.\n"
            f"  Survey them first (polygon-centroid cell histogram per mesh), and\n"
            f"  VALIDATE the survey by reproducing a base whose map is already known\n"
            f"  before trusting it: the glTF v axis is top-origin and Blender's is not,\n"
            f"  so a flipped row convention looks plausible and is wrong.\n"
            f"  See the base roster in this module's docstring. Mapped: "
            f"{', '.join(sorted(atlas.SLOT_MAPS))}")
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


def load_shipped(glb):
    """Load an ALREADY FINISHED body out of `chars/npcs` for plate rendering.

    The other loaders here import a stock KayKit base that a recipe then builds
    onto. These bodies arrive done: generated externally, rigged onto the KayKit
    skeleton, and edited in Blender before export, so the concept book's job is
    to photograph the shipping GLB rather than to rebuild it. Same return shape
    as `load_base`, so `plates.py` needs no special case.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f"{NPCS}/{glb}")
    new = [o for o in bpy.data.objects if o not in before]
    rig = next((o for o in new if o.type == "ARMATURE"), None)
    meshes = [o for o in new if o.type == "MESH" and not o.name.startswith("Icosphere")]
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
#
# WARNING (2026-08-05): these values no longer match the shipped book renders.
# The committed plates carry hand-authored seats (full world matrices; the
# square shield rides `lowerarm.l`, not the hand slot), captured from a live
# Blender review and gated across all four clips. The seats and the protocol
# live in `docs/design/last-bell-held-prop-workflow.md`. Regenerating the book
# through this table will resurrect the fist-on-blade bug documented there.
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
        # A figure whose weapon is BESPOKE builds and mounts it itself (it shares
        # the body's palette atlas, so it cannot be loaded from a finished GLB
        # before that atlas exists). The cast entry stays so the book still lists
        # what he carries.
        if spec.get("built_in"):
            continue
        stem = os.path.basename(spec["url"]).replace(".glb", "")
        path = f"{REPO}/public/models/{spec['url']}"
        # A `seat` is a 4x4 captured from a HUMAN-authored arrangement in the shared
        # Blender session and it wins over the grip table outright. This is the path
        # the GRIPS warning above says the committed plates need; without it a
        # regenerated book silently reverts to a derived seat.
        if spec.get("seat"):
            prop = parts.seated(f"Prop_{stem}", path, rig, spec["bone"], spec["seat"])
        else:
            grip = dict(GRIPS[spec["grip"]])
            grip.update(spec.get("tune", {}))
            prop = parts.held(f"Prop_{stem}", path, rig, spec["bone"], **grip)
        # FIXED props SHIP INSIDE the body GLB (see `export`). Marked on the object
        # so the exporter needs no second lookup into the cast table.
        prop["woc_fixed"] = bool(spec.get("fixed"))
        out.append(prop)
    return out


# ------------------------------------------------------------- export / report
def export(out_path):
    """Write the GLB: rig, skinned meshes, every shipped clip, and any FIXED prop.

    A prop marked `fixed` in `cast.py` ships INSIDE the body, already skinned to
    its carrying bone. That is the whole reason the game can match the concept
    book: there is then ONE artifact, placed once in Blender, and both the book
    and the renderer read it. A prop placed here and re-derived at runtime from a
    grip table is two sources of truth, and they drifted every time.

    An UNFLAGGED prop is still dropped, because it is presentation only and the
    game mounts it through `VisualDef.attach` so the weapon stays swappable. Fixed
    is therefore the right call for a story NPC whose kit never changes, and the
    wrong one for anything a player equips: a baked weapon cannot sheathe (the
    stow system only moves attached props) and it carries its own material, so it
    costs one extra draw.
    """
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    rig.data.pose_position = "POSE"
    for o in [o for o in bpy.data.objects if o.name.startswith("Prop_")
              and not o.get("woc_fixed")]:
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
