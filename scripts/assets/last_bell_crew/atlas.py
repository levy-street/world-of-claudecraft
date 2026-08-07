"""Palette-atlas painter for the KayKit Adventurers rigs.

Every KayKit body in `public/models/chars/players/` shares one trick: a single
material sampling a grid of vertical GRADIENT SWATCHES, and each body part's UVs
sit inside one cell. `Knight_Cape` is 100 percent of one cell; the arm bands are
100 percent of another. So a bespoke character is a REPAINTED GRID, not a new
texture: change one cell and every surface that samples it changes with it, and
the model still costs one material and one draw.

The grid is 8 columns x 4 rows of vertical gradients. A cell is addressed
`r{row}c{col}` with row 0 at the TOP of the image (matching the UV convention
`row = int((1 - v) * 4)`), so the map here reads the same way the UV survey does.

Colours are plain sRGB hex, written straight into the byte image: Blender's
`image.pixels` for a byte image already holds encoded values, so what is set
here is what lands in the PNG.

Deterministic: same inputs -> same pixels. No randomness, no time.
"""

COLS, ROWS = 8, 4


def hex_rgb(h):
    """'#8a4b2b' or 0x8a4b2b -> (r, g, b) floats in 0..1, sRGB-encoded."""
    if isinstance(h, str):
        h = int(h.lstrip("#"), 16)
    return ((h >> 16 & 255) / 255.0, (h >> 8 & 255) / 255.0, (h & 255) / 255.0)


def shade(h, factor):
    """Multiply a hex colour toward black (factor < 1) or white (factor > 1).

    The KayKit swatches fall off to roughly 0.5 of their top value at the
    bottom, which is where the models get their free shading from; every ramp
    built here keeps that character.
    """
    r, g, b = hex_rgb(h)
    if factor <= 1.0:
        return (r * factor, g * factor, b * factor)
    t = factor - 1.0
    return (r + (1.0 - r) * t, g + (1.0 - g) * t, b + (1.0 - b) * t)


def ramp(top, bottom=None, fall=0.52):
    """A cell definition: explicit two-stop gradient, or one colour + falloff."""
    return (hex_rgb(top) if isinstance(top, (str, int)) else top,
            (hex_rgb(bottom) if isinstance(bottom, (str, int)) else bottom)
            if bottom is not None else shade(top, fall))


# Each rig has its OWN cell layout, measured off its UVs (see the module header):
# the knight's dominant plate cell is r0c3, the rogue's coat is r1c0, the druid's
# body is r2c1. A recipe speaks slot NAMES; these maps are the atlas truth.
#
# Every map defines the same "crew extras" (glass, bronze, verdigris, canvas,
# rust, tar, brass, bone) on cells that rig leaves unused, so a bespoke part can
# ask for `bronze` on any base body and get bell bronze.
KNIGHT_SLOTS = {
    "skin": "r0c0",        # face and hands
    "hair": "r0c1",        # sculpted hair cap and brows
    "eyes": "r0c2",        # eyes, near-black
    "plate": "r0c3",       # the dominant harness plate
    "plate_dark": "r0c4",  # recessed plate
    "spare_a": "r0c5",
    "leather": "r0c6",     # belt and straps
    "trim": "r0c7",        # arm bands, body and helm edging: its own cell
    "cloth": "r1c0",       # cape (100 percent) and the chest boss
    "white": "r1c1",
    "steel_b": "r1c2",
    "spare_b": "r1c3",
    "gold": "r1c4",
    "spare_c": "r1c5",
    "spare_d": "r1c6",
    "boots": "r1c7",       # boots, gauntlet cuffs, under-armour
    # Rows 2 and 3 are unused by the knight: free cells the crew claims for
    # bespoke geometry and for re-UV'd details.
    "glass": "r2c0",       # star-glass: the island's own material
    "bronze": "r2c1",      # bell bronze, the Vigil's metal
    "verdigris": "r2c2",
    "canvas": "r2c3",
    "rust": "r2c4",
    "tar": "r2c5",         # tarred rope and oilskin
    "brass": "r2c6",
    "bone": "r2c7",
}


# Cells rows 2 and 3 leave spare gradients on every rig; the crew claims a fixed
# handful so a bespoke part can name a material without knowing the base body.
_EXTRAS_A = {"glass": "r2c0", "bronze": "r2c1", "verdigris": "r2c2",
             "canvas": "r2c4", "rust": "r2c5", "tar": "r2c6",
             "brass": "r3c0", "bone": "r3c1"}
_EXTRAS_B = {"glass": "r2c0", "bronze": "r2c2", "verdigris": "r2c5",
             "canvas": "r2c6", "rust": "r3c2", "tar": "r3c3",
             "brass": "r3c4", "bone": "r3c5"}

ROGUE_SLOTS = {
    "skin": "r0c0", "hair": "r0c1", "eyes": "r0c2",
    "cloth": "r1c0",       # the main garment
    "cape": "r1c1",        # cape (100 percent) and a shoulder panel
    "leather": "r0c5", "trim": "r0c7", "plate": "r0c3",
    "gloves": "r2c7", "boots": "r1c7", "trousers": "r2c3",
    **_EXTRAS_A,
}

# The hooded rogue shares the plain rogue's cells wholesale (one `rogue` material
# and one texture serves both bodies), plus a name for the belt run the plain
# rogue leaves unnamed. What makes this base worth building on is in the UVs: the
# COWL is half of `RogueHooded_Head` and it samples the CAPE's cell (r1c1), and
# the face mask is 100 percent of the garment cell (r1c0). So "dark cowl over a
# pale body" is two palette entries and NO re-UV, and the mask can be recoloured
# or hidden on its own. Cells measured off the UVs the way the module header
# describes, never assumed: survey the polygon centroids per cell and check the
# result reproduces a KNOWN map (`rogue.glb` against ROGUE_SLOTS) before trusting it.
ROGUE_HOODED_SLOTS = {**ROGUE_SLOTS, "belt": "r0c6"}

MAGE_SLOTS = {
    "skin": "r0c0", "hair": "r0c1", "eyes": "r0c2",
    "cloth": "r1c0",       # the robe
    "hat": "r1c1", "cape": "r1c2",
    "trim": "r0c4", "leather": "r0c5", "plate": "r0c3",
    "gloves": "r2c7", "boots": "r1c7", "trousers": "r2c3",
    **_EXTRAS_A,
}

BARBARIAN_SLOTS = {
    "skin": "r0c0", "hair": "r0c1", "eyes": "r0c2",
    "leather": "r0c6", "fur": "r0c7",
    "cloth": "r1c2", "wrap": "r1c5", "trim": "r1c6",
    "boots": "r1c7", "trousers": "r2c3", "gloves": "r2c7",
    "plate": "r0c3", "cape": "r1c0",
    **_EXTRAS_A,
}

DRUID_SLOTS = {
    "cloth": "r1c0",       # robe and hood, which also carries most of the head
    "trim": "r1c1", "hood": "r1c2", "body": "r2c1",
    "skin": "r0c0", "pack": "r0c5", "leather": "r0c6",
    "boots": "r1c7", "pack_dark": "r3c0",
    "hair": "r0c1", "eyes": "r0c2", "plate": "r0c3",
    **_EXTRAS_B,
}

RANGER_SLOTS = {
    "skin": "r0c0", "hair": "r0c1", "eyes": "r0c2",
    "leather": "r0c6", "trim": "r0c7", "accent": "r0c5",
    "cape": "r1c0", "quiver": "r1c6", "cloth": "r1c2",
    "boots": "r1c7", "trousers": "r2c3", "gloves": "r2c7",
    "plate": "r0c3",
    **_EXTRAS_A,
}

# The KayKit Skeletons pack shares the SAME 23-bone rig and the same swatch-grid
# trick as the Adventurers, which is why the break-spawned can be authored the same
# way. Row 3 is unused by all three of these bodies, so it carries the extras.
_SKEL_EXTRAS = {"glass": "r3c0", "bronze": "r3c1", "verdigris": "r3c2",
                "canvas": "r3c3", "rust": "r3c4", "tar": "r3c5",
                "brass": "r3c6", "bone_x": "r3c7"}

SKEL_MINION_SLOTS = {
    "bone": "r1c1",        # skull, jaw, ribs, limbs: the whole frame
    "cloak": "r0c5",       # cloak (100 percent)
    "wrap": "r0c6", "wrap_dark": "r0c7",
    "dark": "r0c2", "trim": "r0c3",
    **_SKEL_EXTRAS,
}

SKEL_ROGUE_SLOTS = {
    "bone": "r1c1",        # skull and jaw (100 percent each)
    "cloth": "r0c3",       # hood and wraps
    "body": "r0c7",        # the torso wrap
    "accent": "r2c2", "dark": "r0c2", "wrap": "r0c6",
    **_SKEL_EXTRAS,
}

SKEL_GOLEM_SLOTS = {
    "stone": "r0c3",       # the body's dominant plate
    "bone": "r1c1",        # skull
    "trim": "r1c3", "accent": "r2c2",
    "dark": "r2c6", "wrap": "r0c6", "seam": "r2c5", "band": "r1c6",
    **_SKEL_EXTRAS,
}

SLOT_MAPS = {
    "knight.glb": KNIGHT_SLOTS,
    "rogue.glb": ROGUE_SLOTS,
    "rogue_hooded.glb": ROGUE_HOODED_SLOTS,
    "mage.glb": MAGE_SLOTS,
    # mage_classic's UVs land on the same cells as mage's, and its first 18 bones
    # carry the same names, so it reuses the map wholesale.
    "mage_classic.glb": MAGE_SLOTS,
    "barbarian.glb": BARBARIAN_SLOTS,
    "druid.glb": DRUID_SLOTS,
    "ranger.glb": RANGER_SLOTS,
    "skeleton_minion.glb": SKEL_MINION_SLOTS,
    "skeleton_rogue.glb": SKEL_ROGUE_SLOTS,
    "skeleton_golem.glb": SKEL_GOLEM_SLOTS,
}

# The slot map the CURRENT figure is being built against. A recipe sets this once
# through `use_slots`, so every `mesh_from`/`cell_uv` call underneath resolves
# names on the right rig without threading the map through every signature.
_active = KNIGHT_SLOTS


def use_slots(slots):
    global _active
    _active = slots
    return slots


def active_slots():
    return _active


def cell_uv(cell, shade_t=0.35, inset=0.18, slots=None):
    """Centre-ish UV inside a cell, addressed as `r2c1` OR by slot name.

    `shade_t` picks WHERE in the gradient to sample (0 = lit top, 1 = dark
    bottom), which is how bespoke geometry gets a value range out of a single
    flat colour."""
    table = slots or _active
    cell = table.get(cell, cell)
    if not (len(cell) == 4 and cell[0] == "r" and cell[2] == "c"
            and cell[1].isdigit() and cell[3].isdigit()):
        raise ValueError(
            f"unknown palette slot {cell!r} for this rig; "
            f"available: {', '.join(sorted(table))}")
    row = int(cell[1])
    col = int(cell[3])
    u = (col + 0.5) / COLS
    t = inset + (1.0 - 2 * inset) * shade_t
    v = 1.0 - (row + t) / ROWS
    return (u, v)


def paint(image, cells, slots=None):
    """Write a swatch grid into a Blender byte image.

    `cells` maps a slot name (or a raw `r0c3` address) to a `ramp()` result.
    Unlisted cells keep a neutral mid grey ramp so a stray UV never samples
    magenta.
    """
    slots = slots or _active
    w, h = image.size
    cw, ch = w // COLS, h // ROWS

    resolved = {}
    for key, value in cells.items():
        addr = slots.get(key, key)
        resolved[addr] = value

    default = ramp(0x8b8b8b)
    px = [0.0] * (w * h * 4)
    for row in range(ROWS):
        for col in range(COLS):
            top, bot = resolved.get(f"r{row}c{col}", default)
            for y in range(ch):
                t = y / max(ch - 1, 1)
                r = top[0] + (bot[0] - top[0]) * t
                g = top[1] + (bot[1] - top[1]) * t
                b = top[2] + (bot[2] - top[2]) * t
                # image row 0 is the BOTTOM of the picture; row 0 of the grid is
                # the top, so flip as we write.
                iy = h - 1 - (row * ch + y)
                base = (iy * w + col * cw) * 4
                for x in range(cw):
                    i = base + x * 4
                    px[i] = r
                    px[i + 1] = g
                    px[i + 2] = b
                    px[i + 3] = 1.0
    image.pixels.foreach_set(px)
    return image
