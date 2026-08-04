"""Per-figure recipes for The Last Bell's cast.

Each builder loads a base body, repaints its palette grid, adds the figure's
bespoke geometry rigidly skinned to single bones, and mounts their held props.
The machinery is `crew.py`, the geometry vocabulary is `parts.py`, and the copy
these figures illustrate is `cast.py`.

One rule the whole file obeys: every figure gets exactly one AUTHORED DETAIL that
carries their arc and reads at gameplay distance, and it is named in the docstring
so the model and the cast sheet cannot drift.

Deterministic: same inputs -> same GLB. No randomness, no time.
"""

import bpy

import atlas
import cast
import crew
import parts
from atlas import ramp

BODY = "Body"
HEAD = "Head"


def _body(meshes, needle=BODY):
    return next(o for o in meshes if needle in o.name)


def _skinned(built, rig, bones):
    for obj in built:
        parts.skin(obj, rig, bones[obj.name])
    return built


def _finish(member, rig, meshes, built, img, mat):
    props = crew.arm(rig, cast.CAST[member].get("weapons", []))
    return {"rig": rig, "meshes": meshes + built + props, "atlas": img, "material": mat}


# --------------------------------------------------------------------- Coalfast
def build_coalfast(helm=False):
    """Warden Coalfast, Redoubt Commander.

    Authored detail: the ROLL OF NAMES, a leather bandolier hung with small bronze
    name-plates, one for every defender he has lost.

    Bare-headed at his post so his face can do the work the campaign needs it to.
    His finale form (`helm=True`) closes the helm and adds the fore-and-aft crest
    the memorial figure wears, which is the island's own iconography: a comb needs
    a helm's hard base to read as an office, and on bare hair it reads as a mohawk.
    """
    hide = ("Knight_HelmetVisor",) if helm else ("Knight_Helmet", "Knight_HelmetVisor")
    rig, meshes = crew.load_base("knight.glb", hide=hide)
    palette = crew.base_palette(
        hair=ramp(0xA8A29A, 0x565149),          # iron grey: the oldest hand on the line
        skin=ramp(0xD3A07A, 0x8E6446),          # weathered by years of this shore
        cloth=ramp(0x8A4B2B, 0x3E1E0E),         # warden rust: his sim entity colour
        cape=ramp(0x8A4B2B, 0x3E1E0E),
    )
    name = "coalfast_helm" if helm else "coalfast"
    img, mat = crew.repaint(meshes, name, palette)

    body, head = _body(meshes), _body(meshes, HEAD)
    # the knight's chest boss shares the cape's cell; his is star-glass
    crew.reuv(body, "cloth", "glass", shade_t=0.22)

    built = []
    bones = {}
    if helm:
        helmet = _body(meshes, "Helmet")
        built.append(parts.comb_crest(
            "Coalfast_Crest", "bronze", (0.0, 0.0, 2.30),
            length=0.60, rise=0.150, thick=0.052, sink=0.14,
            cell_shade=0.24, material=mat, host=helmet, steps=13))
        bones["Coalfast_Crest"] = "head"
    else:
        built.append(parts.hug_band(
            "Coalfast_Circlet", head, 1.812, 1.866, "bronze",
            sides=22, pad=0.011, shade_t=0.30, material=mat))
        bones["Coalfast_Circlet"] = "head"

    # the roll of names: over the RIGHT shoulder to the left hip, so it crosses
    # away from the shield-side pauldron instead of crowding it
    strap = parts.sash_path(body, -0.205, 0.296)
    built.append(parts.strap("Coalfast_NameStrap", strap, width=0.078, thick=0.024,
                             cell="leather", shade_t=0.42, material=mat, up=(0, -1, 0)))
    built.append(parts.tag_row(
        "Coalfast_Names", strap[1:5], count=5, cell="bronze",
        width=0.058, drop=0.080, thick=0.015, shade_t=0.2, material=mat,
        offset=(0, -0.030, 0), span=(0.10, 0.90),
        lengths=(1.0, 0.88, 1.14, 0.94, 1.06)))
    bones["Coalfast_NameStrap"] = "chest"
    bones["Coalfast_Names"] = "chest"

    # shield-side shoulder: he holds a line alone that would kill a militia squad
    built.append(parts.lames(
        "Coalfast_Pauldron", (0.196, 0.004, 1.100), (1.0, 0.058, 0.0),
        count=3, radius=0.172, width=0.064, spread=0.060,
        cell="plate", shade_t=0.16, material=mat, sides=10, arc=0.44, grow=0.050))
    bones["Coalfast_Pauldron"] = "upperarm.l"

    _skinned(built, rig, bones)
    return _finish(name, rig, meshes, built, img, mat)


def build_coalfast_helm():
    return build_coalfast(helm=True)


# ----------------------------------------------------------------------- Ollun
def build_ollun():
    """Riftwatch Ollun, Breach Scholar.

    Authored detail: the INSTRUMENT BANDOLIER WITH EMPTY LOOPS. He gives his
    possessions away across the arc, so the strap that should carry a full set of
    star-glass instruments is missing most of them. The gaps are the character.

    HOODED, and for a specific reason: the KayKit mage body wears long loose hair,
    which reads female at a glance, and Ollun is a he. A hood settles that without
    touching the shipped head, and a man who keeps the signal-fire vigil in Farshore
    weather would own one. His hair is dark: nothing in the spec makes him old.
    """
    rig, meshes = crew.load_base("mage.glb", hide=("Mage_Hat",))
    palette = crew.base_palette(
        cloth=ramp(0x3F5F8A, 0x1B2C42),         # riftwatch slate: his entity colour
        cape=ramp(0x33506F, 0x172538),
        hair=ramp(0x4A3A2C, 0x241C15),          # dark: he is not one of the old ones
        skin=ramp(0xE0AF8A, 0x9C6C4C),
        trim=crew.GLASS,                        # instrument fittings read as glass
        leather=crew.LEATHER,
        boots=crew.LEATHER,
    )
    img, mat = crew.repaint(meshes, "ollun", palette)
    body, head = _body(meshes), _body(meshes, HEAD)
    # The long loose hair is what read as a woman, and it hangs past the hood at the
    # sides where no hood can cover it. Re-UV it onto the ROBE's cell so it reads as
    # the hood's own drape rather than as hair, which settles the silhouette without
    # touching the shipped head mesh.
    crew.reuv(head, "hair", "cloth", shade_t=0.40)

    built = []
    strap = parts.sash_path(body, 0.200, -0.290)
    built.append(parts.strap("Ollun_Bandolier", strap, width=0.070, thick=0.022,
                             cell="leather", shade_t=0.40, material=mat, up=(0, -1, 0)))
    # Two instruments left and six loops. The loops sit on the SAME path so the eye
    # reads the gaps as belonging to the set rather than as missing geometry.
    built.append(parts.tag_row(
        "Ollun_Loops", strap[1:5], count=6, cell="leather",
        width=0.030, drop=0.052, thick=0.013, shade_t=0.55, material=mat,
        offset=(0, -0.028, 0), span=(0.08, 0.92), lengths=(1, 1, 1, 1, 1, 1)))
    built.append(parts.tag_row(
        "Ollun_Instruments", strap[1:5], count=2, cell="glass",
        width=0.044, drop=0.090, thick=0.020, shade_t=0.22, material=mat,
        offset=(0, -0.040, 0), span=(0.10, 0.42), lengths=(1.0, 0.78)))
    built.append(parts.plate("Ollun_Satchel", (0.255, -0.215, 0.700), (0.35, -1, 0),
                             w=0.230, h=0.200, thick=0.075, cell="canvas",
                             shade_t=0.34, material=mat))
    _skinned(built, rig, {
        "Ollun_Bandolier": "chest", "Ollun_Loops": "chest",
        "Ollun_Instruments": "chest", "Ollun_Satchel": "hips",
    })
    return _finish("ollun", rig, meshes, built, img, mat)


# ------------------------------------------------------------------------ Edda
def build_edda():
    """Quartermaster Edda, Redoubt Armorer.

    Authored detail: the CHARGE RACK, star-glass charges she built herself racked
    across her chest where she can reach them without looking.

    Soot is painted up the forearms and down the hem, the two places a forge
    actually marks, rather than as an even grime pass.
    """
    # NOT the druid body: its hood carries antlers that cannot be hidden without
    # losing the head with them, and an armorer in antlers is a different game.
    rig, meshes = crew.load_base("rogue.glb", hide=("Rogue_Cape",))
    palette = crew.base_palette(
        cloth=ramp(0x6B6B3A, 0x2F2F18),         # forge olive: her entity colour
        cape=ramp(0x5C5B32, 0x272714),
        trim=crew.BRONZE,
        skin=ramp(0xCE9C77, 0x6B4A33),          # soot does not wash out
        hair=ramp(0x6E4A2E, 0x38251A),
        leather=crew.LEATHER,
        gloves=crew.TAR,                        # forge gloves, permanently black
        trousers=ramp(0x5A5334, 0x2A2619),
        boots=crew.TAR,
    )
    img, mat = crew.repaint(meshes, "edda", palette)
    body = _body(meshes)

    built = []
    strap = parts.sash_path(body, -0.195, 0.280)
    built.append(parts.strap("Edda_ChargeStrap", strap, width=0.086, thick=0.026,
                             cell="leather", shade_t=0.38, material=mat, up=(0, -1, 0)))
    # the charges themselves: star-glass, stubby, racked upright
    built.append(parts.tag_row(
        "Edda_Charges", strap[1:5], count=4, cell="glass",
        width=0.052, drop=0.105, thick=0.046, shade_t=0.20, material=mat,
        offset=(0, -0.040, 0), span=(0.10, 0.90), lengths=(1.0, 1.0, 0.92, 1.0)))
    # bronze caps, so a charge reads as built rather than found
    built.append(parts.tag_row(
        "Edda_ChargeCaps", strap[1:5], count=4, cell="bronze",
        width=0.056, drop=0.030, thick=0.050, shade_t=0.26, material=mat,
        offset=(0, -0.040, 0), span=(0.10, 0.90), lengths=(1, 1, 1, 1)))
    # a tool roll at the hip: the kit she keeps the whole redoubt running on
    built.append(parts.plate("Edda_ToolRoll", (-0.250, -0.205, 0.690), (-0.30, -1, 0),
                             w=0.210, h=0.165, thick=0.085, cell="leather",
                             shade_t=0.30, material=mat))
    _skinned(built, rig, {
        "Edda_ChargeStrap": "chest", "Edda_Charges": "chest",
        "Edda_ChargeCaps": "chest", "Edda_ToolRoll": "hips",
    })
    return _finish("edda", rig, meshes, built, img, mat)


# ------------------------------------------------------------------------ Saul
def build_saul():
    """Mender Saul, Field Surgeon.

    Authored detail: the MENDED APRON. Every patch is stitched the way he ties a
    bandage, because he mends his own kit with the only hands he has. The only
    figure whose signature is repair rather than equipment.

    Built on `mage_classic` rather than the mage body: it carries a short dark cut
    and a plain male face, where the mage body's long loose hair read as a woman.
    Its UVs land on the same palette cells and its bones carry the same names, so
    the recipe is unchanged. He is exhausted, not old, so his hair stays dark.
    """
    rig, meshes = crew.load_base("mage_classic.glb")
    palette = crew.base_palette(
        cloth=ramp(0x9A3B3B, 0x45191A),         # mender's red: his entity colour
        hair=ramp(0x3A2E24, 0x1A1410),          # dark: the tiredness is not age
        skin=ramp(0xDCA684, 0x936246),
        trim=crew.LINEN,                        # bandage linen, the newest thing on him
        leather=crew.LEATHER,
        boots=crew.LEATHER,
    )
    img, mat = crew.repaint(meshes, "saul", palette)
    body = _body(meshes)

    built = []
    # the apron: a narrow bib over a wider skirt, so it reads as a garment rather
    # than one slab taped to his chest
    front = parts.surface_front(body, 0.880) or -0.32
    built.append(parts.plate("Saul_ApronBib", (0.0, front - 0.026, 1.020), (0, -1, 0),
                             w=0.270, h=0.250, thick=0.020, cell="canvas",
                             shade_t=0.26, material=mat))
    built.append(parts.plate("Saul_Apron", (0.0, front - 0.032, 0.760), (0, -1, 0),
                             w=0.420, h=0.400, thick=0.022, cell="canvas",
                             shade_t=0.34, material=mat))
    # `trim` carries the bandage linen; three materials across four patches, so no
    # two adjacent repairs came off the same bolt
    patches = (
        (-0.105, 0.845, 0.115, 0.100, "trim", 0.24),
        (0.090, 0.790, 0.095, 0.120, "leather", 0.36),
        (-0.045, 0.665, 0.135, 0.090, "canvas", 0.60),
        (0.115, 0.625, 0.080, 0.080, "trim", 0.42),
    )
    for i, (px, pz, pw, ph, cell, shade) in enumerate(patches):
        built.append(parts.plate(f"Saul_Patch{i}", (px, front - 0.046, pz), (0, -1, 0),
                                 w=pw, h=ph, thick=0.014, cell=cell,
                                 shade_t=shade, material=mat))
    built.append(parts.strap("Saul_Roll", [
        (-0.235, front + 0.010, 1.145), (0.0, front - 0.022, 1.100),
        (0.235, front + 0.010, 1.145),
    ], width=0.072, thick=0.030, cell="leather", shade_t=0.34,
        material=mat, up=(0, -1, 0)))
    _skinned(built, rig, {
        "Saul_Apron": "spine", "Saul_ApronBib": "chest", "Saul_Roll": "chest",
        **{f"Saul_Patch{i}": "spine" for i in range(len(patches))},
    })
    return _finish("saul", rig, meshes, built, img, mat)


# ------------------------------------------------------------------------- Tam
def build_tam():
    """Bellkeeper Tam, Watchbell Keeper.

    Authored detail: the BELL-STRIKER, worn pale where his hand goes. It is the
    keepsake the campaign hands you afterwards, so it has to be recognisably his
    before you ever receive it. Bespoke geometry, because no shipped weapon reads
    as a bell-striker and the keepsake has to match.
    """
    rig, meshes = crew.load_base("barbarian.glb", hide=("Barbarian_BearHat",))
    palette = crew.base_palette(
        cloth=ramp(0x4A7B6B, 0x1F3730),         # watch teal: his entity colour
        fur=ramp(0x3E6459, 0x1A2C27),
        wrap=crew.CANVAS,
        trim=crew.BRONZE,
        leather=crew.LEATHER,
        hair=ramp(0xB3ADA2, 0x5E5A51),          # forty years at the causeway's end
        skin=ramp(0xD3A07A, 0x8A6144),
        boots=crew.LEATHER,
    )
    img, mat = crew.repaint(meshes, "tam", palette)
    body = _body(meshes)

    built = []
    # THE STRIKER. Bronze head, leather haft, and a pale band where sixty years of
    # grip have taken the colour out of the same four inches.
    # Chunky on purpose: a KayKit prop at this scale needs real thickness or it
    # vanishes at gameplay distance, and this one has to be recognisable enough
    # that receiving it later lands.
    hand = (-0.883, 0.050, 1.049)
    tip = (-0.883, -0.560, 1.049)
    built.append(parts.tube("Tam_StrikerHaft", hand, tip, 0.044, "leather",
                            sides=10, shade_t=0.42, material=mat))
    built.append(parts.tube("Tam_StrikerGrip", (-0.883, -0.020, 1.049),
                            (-0.883, -0.230, 1.049), 0.050, "bone",
                            sides=10, shade_t=0.30, material=mat))
    built.append(parts.tube("Tam_StrikerHead", (-0.883, -0.560, 1.049),
                            (-0.883, -0.760, 1.049), 0.115, "bronze",
                            sides=12, shade_t=0.24, material=mat, r2=0.098))
    # the hand-bell at his hip: the ordinary iron clapper's voice, before the Bellheart
    built.append(parts.tube("Tam_HipBell", (0.250, -0.150, 0.690), (0.250, -0.150, 0.520),
                            0.062, "bronze", sides=12, shade_t=0.30,
                            material=mat, r2=0.105))
    _skinned(built, rig, {
        "Tam_StrikerHaft": "handslot.r", "Tam_StrikerGrip": "handslot.r",
        "Tam_StrikerHead": "handslot.r", "Tam_HipBell": "hips",
    })
    return _finish("tam", rig, meshes, built, img, mat)


# ------------------------------------------------------------------------ Nell
def build_nell():
    """Nell, bell-runner.

    Authored detail: the TALLY CORD, a knotted line at her hip, one knot for every
    run she has made since her father died, because counting them is how she keeps
    going back.

    Shorter than every adult on the island. No armour and no weapon: her job is to
    be somewhere else, fast.

    Built on the rogue body rather than the ranger's: the ranger carries a moustache
    (it went to Ewald) and its quiver and cape read as a hunter, which is exactly
    what she is not. Light cloth, a short cloak, nothing issued.
    """
    rig, meshes = crew.load_base("rogue.glb")
    palette = crew.base_palette(
        cape=ramp(0x5A7A9A, 0x263644),          # runner's blue: her entity colour
        cloth=ramp(0x6E8CA8, 0x2E3D4B),         # pale: the lightest cloth on the island
        leather=crew.LEATHER_PALE,
        trim=crew.BRONZE,
        gloves=crew.LEATHER_PALE,
        trousers=ramp(0x6B6252, 0x332F27),
        hair=ramp(0x9A7647, 0x53401F),          # young, sun-lightened
        skin=ramp(0xE8BC96, 0xAE805C),          # the youngest face in the book
        boots=crew.LEATHER,
    )
    img, mat = crew.repaint(meshes, "nell", palette)
    body = _body(meshes)

    built = []
    # the message satchel, cut down from something of her father's
    built.append(parts.plate("Nell_Satchel", (0.245, -0.200, 0.715), (0.30, -1, 0),
                             w=0.245, h=0.205, thick=0.080, cell="canvas",
                             shade_t=0.32, material=mat))
    built.append(parts.strap("Nell_SatchelStrap", parts.sash_path(body, -0.185, 0.245),
                             width=0.062, thick=0.020, cell="leather", shade_t=0.36,
                             material=mat, up=(0, -1, 0)))
    # THE TALLY CORD: knots on a line, one per run. Sizes step so the eye counts them.
    cord = [(-0.230, -0.190, 0.735), (-0.255, -0.175, 0.640), (-0.235, -0.165, 0.545)]
    built.append(parts.strap("Nell_TallyCord", cord, width=0.020, thick=0.020,
                             cell="leather", shade_t=0.50, material=mat, up=(0, -1, 0)))
    built.append(parts.tag_row("Nell_TallyKnots", cord, count=6, cell="bone",
                               width=0.034, drop=0.034, thick=0.032, shade_t=0.30,
                               material=mat, offset=(-0.012, -0.020, 0),
                               span=(0.05, 0.95), lengths=(1, 1, 1, 1, 1, 1)))
    # the hand-bell she runs with: small, and the loudest thing she owns
    built.append(parts.tube("Nell_HandBell", (-0.883, -0.090, 1.049),
                            (-0.883, -0.215, 1.049), 0.040, "bronze",
                            sides=12, shade_t=0.26, material=mat, r2=0.070))
    _skinned(built, rig, {
        "Nell_Satchel": "hips", "Nell_SatchelStrap": "chest",
        "Nell_TallyCord": "hips", "Nell_TallyKnots": "hips",
        "Nell_HandBell": "handslot.r",
    })
    return _finish("nell", rig, meshes, built, img, mat)


# ---------------------------------------------------------------------- Ewald
def build_ewald():
    """Ferryman Ewald, the Farshore crossing.

    Authored detail: the SOU'WESTER. A low oilskin hat with the brim turned down
    and a long tail at the back, which is the single most legible way to say SAILOR
    at gameplay distance. Under it a tarred coat, rope coils over the shoulder, and
    the fare tin on a cord where a passenger can reach it without being asked,
    because Q0 lets you pay or decline and he takes you either way.

    Built on the ranger body: it carries a moustache and a plain male face, and its
    layered practical clothes read as working kit rather than armour.
    """
    rig, meshes = crew.load_base("ranger.glb", hide=("Ranger_Quiver", "Ranger_Cape"))
    palette = crew.base_palette(
        # oilskin: dark and waxy, but never crushed to black or it stops being cloth
        cloth=ramp(0x4B4A41, 0x24231F),
        trim=ramp(0x6C7C96, 0x333F52),          # his entity colour, as the coat's lining
        accent=ramp(0x8A8468, 0x45412F),        # salt-bleached canvas
        leather=ramp(0x5E4630, 0x2C2118),
        gloves=crew.TAR,
        trousers=ramp(0x585141, 0x29251E),
        boots=crew.TAR,
        hair=ramp(0x6E6154, 0x38312A),          # greying, not white: a lifer, not an elder
        skin=ramp(0xD09A72, 0x8B5F42),          # thirty years of weather on the strait
    )
    img, mat = crew.repaint(meshes, "ewald", palette)
    body, head = _body(meshes), _body(meshes, HEAD)

    # The hat is the approved item and its geometry must not change, so it is FITTED
    # FIRST, off the untouched skull. Only then is the HAIR that was breaking its
    # silhouette tucked inward. Tucking first shrinks the profile `souwester`
    # measures and quietly re-sizes the approved hat, which is the one thing this
    # fix is not allowed to do.
    # Hat FIRST, off the untouched skull, so its fit is measured against the real
    # head; then the hair is tucked under it. Tucking first shrinks the profile
    # `souwester` measures and silently re-sizes the hat.
    BRIM_Z, CROWN_Z = 1.92, 2.235
    built = [parts.souwester("Ewald_Souwester", head, "cloth", shade_t=0.22,
                             material=mat, brim=0.30, tail=0.60,
                             brim_z=BRIM_Z, crown_z=CROWN_Z, flat=0.55)]
    # Values SOLVED against the ray-cast coverage test below, not guessed. The
    # baseline was 82 hair vertices outside the shell; 0.95/0.86 left 60, 0.80/0.62
    # left 2, and 0.72/0.54 reaches zero with margin. `base` matters more than
    # `shrink`: the band just above the brim is where the crown wall is tightest, and
    # a ramp starting at 1.0 leaves exactly that band untouched. The z ceiling is the
    # separate guarantee that nothing rises through the top.
    # SKIN as well as hair: above the brow the scalp and the ear tops belong under
    # the hat, and four skin vertices at the ear tops were the last thing poking
    # through the crown wall after the hair was solved.
    parts.tuck_under_hat(head, ("hair", "skin"), BRIM_Z, base=0.72, shrink=0.54,
                         ease=0.5, drop=0.05, z_ceiling=CROWN_Z - 0.085)
    # MEASURE it, do not eyeball it, and measure EVERY head vertex rather than just
    # the hair: scoping the first check to hair is what let the ear tops through.
    above, outside = parts.outside_shell(
        head, range(len(head.data.vertices)), built[0], BRIM_Z)
    if above or outside:
        raise ValueError(
            f"Ewald: the hat does not cover the head ({len(above)} above the crown, "
            f"{len(outside)} through the side). Tighten base/shrink or raise crown_z."
        )

    # A fuller beard. The ranger head ships a moustache and a small chin tuft; this
    # grows them into a jaw-to-jaw beard so he reads as a man who has been on the
    # strait for thirty years rather than a clean-shaven deckhand. Built off the
    # MEASURED jaw (nose apex sits at z=1.52, jaw 1.30 to 1.45), widest at the chin
    # and tapering up toward the sideburns.
    # Laid on the face by ray cast, and shaped like a beard rather than a strap: the
    # top edge sits below the mouth at the chin (the nose apex measures z=1.52, so
    # anything above about 1.46 climbs over the shipped moustache) and rises to the
    # sideburns at the sides, while the bottom hangs lowest at the front and tucks up
    # under the jaw corners.
    # A beard GROWN FROM HIS OWN JAW, not a shell fitted over it. `grow_patch`
    # copies the head's front-lower faces and swells them along their normals with
    # the displacement tapered to zero at the patch rim, so the mass is his face and
    # the edges stay welded flush. The two earlier attempts built revolved and lofted
    # shells; both landed as a dark panel taped to his cheek, because a shell is
    # unrelated to the surface it sits on however it is tuned.
    #
    # The upper boundary is beard-shaped: low at the chin (the nose apex measures
    # z=1.52, so anything above about 1.44 climbs over the shipped moustache) rising
    # toward the sideburns with |x|.
    def jaw(centre, normal):
        limit = 1.435 + 0.30 * (abs(centre.x) / 0.53) ** 1.4
        return centre.y < -0.05 and 1.20 <= centre.z <= limit

    built.append(parts.grow_patch(
        "Ewald_Beard", head, jaw, "hair", pad=0.055, shade_t=0.44,
        material=mat, exclude_cells=("hair",)))

    # THE FARE TIN on a neck cord, chest height, reachable
    front = parts.surface_front(body, 1.020) or -0.30
    built.append(parts.strap("Ewald_TinCord", [
        (-0.150, front + 0.030, 1.190), (0.0, front - 0.010, 1.075),
        (0.150, front + 0.030, 1.190),
    ], width=0.018, thick=0.018, cell="leather", shade_t=0.52,
        material=mat, up=(0, -1, 0)))
    built.append(parts.plate("Ewald_FareTin", (0.0, front - 0.052, 0.985), (0, -1, 0),
                             w=0.145, h=0.130, thick=0.060, cell="bronze",
                             shade_t=0.28, material=mat))
    # the tarred coil over the shoulder: spliced so often no two lengths match
    for i, (r, z) in enumerate(((0.150, 1.170), (0.136, 1.118), (0.124, 1.070))):
        built.append(parts.tube(f"Ewald_Coil{i}", (0.215 - r, 0.070, z),
                                (0.215 + r, 0.070, z), 0.026, "tar",
                                sides=8, shade_t=0.36 + 0.08 * i, material=mat))
    _skinned(built, rig, {
        "Ewald_Souwester": "head", "Ewald_Beard": "head",
        "Ewald_TinCord": "chest", "Ewald_FareTin": "chest",
        **{f"Ewald_Coil{i}": "upperarm.l" for i in range(3)},
    })
    return _finish("ewald", rig, meshes, built, img, mat)


# ---------------------------------------------------------------------- Marsh
def build_marsh():
    """Sergeant Marsh, Town Militia.

    Authored detail: MISMATCHED KIT, and the halberd. A halberd was a sergeant's
    literal badge of rank, so it doubles as the one issued thing he owns and as the
    reason his line can hold a road. Carried grounded and vertical at his post.

    He is the measuring stick: what the militia cannot handle is what the squad is
    for, and his gear has to say that without dialogue. Everything about him is
    cheaper, patched or improvised, EXCEPT the polearm.

    Separated from Coalfast at every level, because they share a body and stand two
    POIs apart: helmed against bare-headed, no cloak against warden rust, warm town
    iron against cold salt-scoured steel, a two-handed halberd against sword and
    heavy shield, and one pauldron on the RIGHT against a three-lame stack on the LEFT.
    """
    rig, meshes = crew.load_base("knight.glb", hide=("Knight_HelmetVisor", "Knight_Cape"))
    # THREE VALUES, deliberately. The first pass painted iron, wool and rope at almost
    # the same mid warm grey and he read as one flat monochrome mass with no structure,
    # where Ewald works because he has a pale field, a dark field and one accent.
    palette = crew.base_palette(
        plate=ramp(0xCFC4A8, 0x7C735C),         # the padded jack: quilted cloth, the pale field
        plate_dark=ramp(0x5A5249, 0x2C2721),
        trim=ramp(0x4A3826, 0x241B12),          # DARK leather edging: the dark field
        leather=ramp(0xA98A5C, 0x5B4830),        # hemp and rope: repairs from the docks
        spare_a=ramp(0xA98A5C, 0x5B4830),
        boots=ramp(0x3E3226, 0x1E1811),          # dark boots and under-armour
        spare_b=ramp(0x8A8F8B, 0x434744),        # the issued helm: the only real metal on him
        steel_b=ramp(0x6A6A62, 0x343430),        # small iron fittings: buckle, chest patch
        canvas=ramp(0xD2C8AE, 0x82795F),
        cloth=crew.BRONZE,                       # the rank badge, and nothing else
        hair=ramp(0x54462F, 0x2A231A),
        skin=ramp(0xD4A177, 0x8D6245),
    )
    img, mat = crew.repaint(meshes, "marsh", palette)
    body = _body(meshes)
    helmet = _body(meshes, "Helmet")

    # THE VALUE FIX, and it needs no geometry at all. On the knight body one cell
    # (`plate`) covers the cuirass, arms, legs AND the helmet, which is exactly why he
    # read as one flat monochrome mass: there was no way to separate them. So move the
    # HELMET's faces onto their own cell and then repaint `plate` as pale quilted cloth.
    # His whole body becomes the padded jack a town could actually afford and the helm
    # stays iron, which is the militia read: cloth armour under an issued helmet.
    #
    # A jack GROWN from his torso faces was tried first and cut: the colour boundary
    # follows triangle edges, so it came out as a sawtooth that read as tearing, and
    # aligning it to the body's real edge loops (z=0.958 and z=1.255) shrank it to a
    # sliver at the collar. Recolouring the whole garment is both simpler and truer.
    # The helmet moves to a cell the knight body does NOT use. `steel_b` was the first
    # choice and it backfired: the body carries a small chest patch on that cell, so
    # painting it helm-iron put a pale scrap on his sternum, which is the stray white
    # fleck the review flagged.
    crew.reuv(helmet, "plate", "spare_b", shade_t=0.24)
    crew.reuv(helmet, "trim", "spare_b", shade_t=0.34)   # and its crown fins with it
    crew.reuv(body, "cloth", "bronze", shade_t=0.30)     # one issued rank badge

    built = []

    # ONE pauldron, on the right. Its lames were the same cell at nearly the same value
    # as the arm under them, so the shoulders read symmetric from every angle and his
    # authored asymmetry did not exist on screen: darker cell, and a fifth larger.
    built.append(parts.lames(
        "Marsh_Pauldron", (-0.196, 0.004, 1.100), (-1.0, 0.058, 0.0),
        count=2, radius=0.201, width=0.072, spread=0.070,
        cell="plate_dark", shade_t=0.22, material=mat, sides=9, arc=0.44, grow=0.055))

    # Rope lashings, ASYMMETRIC on purpose. Two parallel horizontal straps read as a
    # ladder bolted to his chest; one thick wrap plus one diagonal over the shoulder
    # reads as rope someone improvised, which is the point of him.
    waist = parts.surface_front(body, 0.995) or -0.30
    built.append(parts.strap("Marsh_Lashing0", [
        (-0.250, waist + 0.060, 1.010), (-0.090, waist - 0.036, 0.992),
        (0.090, waist - 0.036, 0.986), (0.250, waist + 0.060, 0.972),
    ], width=0.052, thick=0.046, cell="leather", shade_t=0.30,
        material=mat, up=(0, -1, 0)))
    built.append(parts.strap("Marsh_Lashing1", parts.sash_path(body, -0.200, 0.235,
                                                              z_hi=1.230, z_lo=0.968),
                             width=0.046, thick=0.042, cell="leather", shade_t=0.42,
                             material=mat, up=(0, -1, 0)))

    _skinned(built, rig, {
        "Marsh_Pauldron": "upperarm.r",
        "Marsh_Lashing0": "chest", "Marsh_Lashing1": "chest",
    })
    return _finish("marsh", rig, meshes, built, img, mat)


# ------------------------------------------------------- the break-spawned
# The Quaternius goblin/giant/demon bodies these mobs used to fall back on are flat
# untextured blobs at this scale. The KayKit SKELETONS pack is hand-painted, shares
# the same 23-bone rig, and uses the same palette-swatch atlas, so the break-spawned
# get the same treatment as the crew: a repaint plus bespoke geometry.
#
# Skeletal frames also happen to be the right read for the lore. Rifts are
# "unfinished rooms from the Dreamer's Sleeping World pressing into the waking
# world", and a body that is not finished being a body says that better than a
# cartoon devil does. Star-glass grows through all of them: the island's own
# material, coming back through the wound wrong.


def _spawn_palette(color, bone, **over):
    pal = crew.base_palette(
        bone=bone,
        glass=crew.GLASS,
        cloak=ramp(color, 0x14101C),
        cloth=ramp(color, 0x14101C),
        body=ramp(color, 0x14101C),
        wrap=ramp(0x5A5346, 0x2A261F),
        wrap_dark=ramp(0x3C372E, 0x1B1915),
        dark=ramp(0x1A1620, 0x000000),
        accent=ramp(color, 0x14101C),
    )
    pal.update(over)
    return pal


def build_riftspawn():
    """Riftspawn: the common spill.

    A void-bleached frame in a torn wrap, with star-glass breaking out of the ribs.
    It knows only the way it came and the thing in front of it, so the silhouette
    stays simple: this is the enemy you kill twelve of while the militia watches.
    """
    rig, meshes = crew.load_base("skeleton_minion.glb")
    img, mat = crew.repaint(meshes, "riftspawn", _spawn_palette(
        0x7A3FB0, ramp(0xC9BEDC, 0x6A5F80)))     # bone gone violet-grey in the wound
    body = _body(meshes)
    built = [parts.spines("Riftspawn_Shards", body, "glass", count=5,
                          length=0.30, base=0.048, along=(0.30, 0.75),
                          shade_t=0.20, material=mat)]
    _skinned(built, rig, {"Riftspawn_Shards": "chest"})
    return _finish("riftspawn", rig, meshes, built, img, mat)


def build_breach_wretch():
    """Breach Wretch: the small ones, and they come fast.

    The hooded skeleton rogue: a quick, low silhouette that reads as a crowd rather
    than a threat. Nothing about one of them is frightening, which is the point.
    """
    rig, meshes = crew.load_base("skeleton_rogue.glb")
    img, mat = crew.repaint(meshes, "breach_wretch", _spawn_palette(
        0x5A4A78, ramp(0xBFB6C8, 0x625B70),
        cloth=ramp(0x5A4A78, 0x201A2C),
        body=ramp(0x4A3F60, 0x1B1726)))
    body = _body(meshes)
    built = [parts.spines("Wretch_Shards", body, "glass", count=3,
                          length=0.20, base=0.038, along=(0.35, 0.66),
                          shade_t=0.22, material=mat)]
    _skinned(built, rig, {"Wretch_Shards": "chest"})
    return _finish("breach_wretch", rig, meshes, built, img, mat)


def build_sundered_horror():
    """The Sundered Horror: the biggest thing the cliffs' break ever let through.

    The skeleton golem, at four yards the only figure in the book that stands taller
    than a person. Star-glass has grown right through the shoulders, and the plate is
    stained the wound's own magenta: it is walking evidence that this year is the
    worst in living memory.
    """
    rig, meshes = crew.load_base("skeleton_golem.glb")
    img, mat = crew.repaint(meshes, "sundered_horror", _spawn_palette(
        0x8A2F6A, ramp(0xD8CBC0, 0x6E645C),
        stone=ramp(0x7C6A74, 0x39303A),
        trim=ramp(0x8A2F6A, 0x2E0F22),
        seam=ramp(0x8A2F6A, 0x2E0F22),
        band=ramp(0x5E4E58, 0x2A232B),
        dark=ramp(0x2A222A, 0x0E0B0E)))
    body = _body(meshes)
    built = [parts.spines("Horror_Shards", body, "glass", count=6,
                          length=0.46, base=0.085, along=(0.24, 0.80),
                          shade_t=0.18, material=mat)]
    _skinned(built, rig, {"Horror_Shards": "chest"})
    return _finish("sundered_horror", rig, meshes, built, img, mat)


def _tint_material(mat, color, strength):
    """Apply the runtime entity tint, the way the renderer actually applies it.

    `tintedMaterial` in `src/render/characters/assets.ts` does exactly one thing:
    `mat.color.lerp(tint, strength)`. It never touches the texture. Since
    `mat.color` MULTIPLIES the map, the faithful reproduction is to multiply the
    baked texture by `lerp(baseColorFactor, tint, strength)`.

    Blending the shaded RESULT toward the tint instead (the obvious first guess)
    lightens dark textures toward the mid tone, which turned the Void Stalker into
    a pale lilac wolf where the game draws a nearly black one.
    """
    if not mat.use_nodes:
        return
    tree = mat.node_tree
    bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return
    tint = atlas.hex_rgb(color)
    base = bsdf.inputs["Base Color"]
    if not base.is_linked:
        # Flat-material bodies (the spider) carry a whole PALETTE across several
        # materials. `mat.color` IS that colour, so the lerp lands directly on it
        # and the per-material differences survive.
        current = tuple(base.default_value)[:3]
        base.default_value = (*[c + (t - c) * strength for c, t in zip(current, tint)], 1.0)
        return
    # textured: glTF's default baseColorFactor is white, so that is what gets lerped
    factor = tuple(1.0 + (t - 1.0) * strength for t in tint)
    source = base.links[0].from_socket
    mix = tree.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs["Fac"].default_value = 1.0
    mix.inputs["Color2"].default_value = (*factor, 1.0)
    tree.links.new(source, mix.inputs["Color1"])
    tree.links.new(mix.outputs["Color"], base)


def build_creature(member):
    """A break-spawned body that keeps a BAKED texture (the wolf, the spider).

    These two have no palette grid, so they are re-coloured the way the renderer
    does it at runtime (`mat.color.lerp(tint, strength)` in
    `src/render/characters/assets.ts`) and then given bespoke star-glass, which is
    what marks them as rift-touched rather than ordinary fauna.
    """
    entry = cast.CAST[member]
    rig, meshes = crew.load_creature(entry["base"])
    strength = entry.get("tint_strength", 0.55)
    for obj in meshes:
        for mat in [m for m in obj.data.materials if m]:
            _tint_material(mat, entry["entity_color"], strength)
    # Deeper than the crew's star-glass swatch and only faintly lit: at pale blue
    # with strong emission these rendered as big white plates and the wolf read as a
    # stegosaurus rather than as something the wound had grown through.
    # NO bespoke geometry on these two. Star-glass dorsal shards were built and cut:
    # seated at every offset tried they still read as pale ice spikes standing off the
    # back rather than as glass grown through it, and the tint alone already makes a
    # convincingly rift-touched animal (compare the game's own bestiary still,
    # `public/guide-stills/mob_wolf__2f2a44.webp`). Naming the gap beats shipping it.
    built = []
    return {"rig": rig, "meshes": meshes + built, "atlas": None, "material": None}


RECIPES = {
    "ewald": build_ewald,
    "riftspawn": build_riftspawn,
    "breach_wretch": build_breach_wretch,
    "sundered_horror": build_sundered_horror,
    "marsh": build_marsh,
    "coalfast": build_coalfast,
    "coalfast_helm": build_coalfast_helm,
    "ollun": build_ollun,
    "edda": build_edda,
    "saul": build_saul,
    "tam": build_tam,
    "nell": build_nell,
}

# The two baked-texture bodies keep the generic creature path.
for _id in ("void_stalker", "tidemill_stalker"):
    RECIPES[_id] = (lambda m: (lambda: build_creature(m)))(_id)
