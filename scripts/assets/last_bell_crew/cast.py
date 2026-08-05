"""The Last Bell cast sheet: who each figure is, what they carry, and why.

Data-as-code, and the concept book's single source of truth. `plates.py` copies
these entries into the render manifests and `build_concept_book.mjs` lays them
out, so the page's copy, palette chips, weapon reasons and plate captions can
never drift from the models the same table drove.

`height_yards` is the RUNTIME height (`VisualDef.height`, times a mob's `scale`),
not the source bbox: that is the number the game normalises each rig to, so it is
the honest one for a scale chart. Humanoid NPCs are 2.6.

`poses` frames are chosen off each clip's most EXTENDED beat, measured rather
than guessed, so a plate lands on the strike and not the wind-down.

Nothing here invents a fact about the island. Anchors:
`docs/design/last-bell-campaign.html`, `docs/design/farshore-last-bell-spec.md`
sections 4 and 5, `src/sim/content/farshore.ts`,
`src/sim/content/last_bell_campaign.ts`.
"""

HUMANOID = 2.6

CREW_POSES = [
    ("Idle", 7, "At their post"),
    ("Walking_A", 6, "On the move"),
    ("1H_Melee_Attack_Chop", 17, "The strike"),
    ("Block", 8, "Under pressure"),
]

CAST = {
    # ----------------------------------------------------------------- crossing
    "ewald": {
        "name": "Ferryman Ewald",
        "title": "The Farshore Crossing",
        "post": "The mainland pier, and the Gullhaven berth",
        "entity_color": "#4a5a7a",
        "base": "ranger.glb",
        "height_yards": HUMANOID,
        "role": "Not a fighter. The only way onto a besieged island.",
        "blurb": (
            "He sells nothing and saves lives anyway. Nobody crosses for the "
            "fishing any more, so every passenger he lands is someone who chose "
            "to come, and he has learned to tell them the one thing that matters "
            "before they step off: mind the bell, the town listens to it the way "
            "you listen to weather."
        ),
        "signature": (
            "The sou'wester. A low oilskin hat with the brim turned down and a long "
            "tail at the back, which is the single most legible way to say SAILOR at "
            "gameplay distance. Under it the fare tin on a cord, hung where a "
            "passenger can reach it without being asked, because Q0 lets you pay or "
            "decline and he takes you either way."
        ),
        "palette": [
            ("Oilskin", "#4b4a41", "Waxed cloth, wet for thirty years. Dark, but still cloth."),
            ("Salt canvas", "#8a8468", "Sailcloth bleached pale by the strait."),
            ("Ferry slate", "#6c7c96", "His sim entity colour, worn as the coat's lining."),
            ("Bell bronze", "#9c7437", "The fare tin, and the only bright thing on him."),
        ],
        "notes": [
            "Built on the ranger body: a moustache and a plain male face, and layered "
            "working clothes rather than armour.",
            "The hat is doing the characterisation. A dark coat alone read as a "
            "generic villager; the sou'wester makes him a sailor in one silhouette.",
        ],
        # No weapon. He is a declared non-combatant, and the spear the first pass
        # gave him was `spear_a.glb`, the tribal one, tassels and all: in the Cheer
        # plate the shaft crossed his face and he read as biting it. The outfit
        # carries him without it.
        "weapons": [],
        "poses": [
            ("Idle", 7, "At the gangplank"),
            ("Walking_A", 6, "Working the deck"),
            ("Cheer", 31, "Calling the crossing"),
            ("Block", 8, "Bracing on a swell"),
        ],
    },
    "marsh": {
        "name": "Sergeant Marsh",
        "title": "Town Militia",
        "post": "The militia line, Watch Meadow",
        "entity_color": "#6a5a3a",
        "base": "knight.glb",
        "height_yards": HUMANOID,
        "role": "Holds the road. Knows exactly what his line can and cannot kill.",
        "blurb": (
            "Operational and unsentimental. His line holds the road, and when the "
            "rift coughs up something they cannot put down he points at you and "
            "says so plainly. He is the measuring stick the campaign uses: what "
            "the militia cannot handle is what the squad is for."
        ),
        "signature": (
            "The sword, and everything around it being worse. He owns exactly "
            "one good blade, and everything around it being worse. Around it: one "
            "pauldron on his right and nothing on the other, rope lashings where "
            "straps should be, a padded jack instead of plate, and a town kettle hat "
            "rather than anything a knight would own."
        ),
        "palette": [
            ("Padded jack", "#cfc4a8", "Quilted cloth, not plate: what a town could actually afford, and his pale field."),
            ("Militia iron", "#76726a", "The kettle hat, and the only palette metal on him. Warm, so it reads as town iron beside the squad's cold salt-scoured steel, and kept well under the jack: the hat is his largest single surface and will win the read at any lighter value."),
            ("Dark leather", "#4a3826", "Edging and boots: his dark field."),
            ("Hemp rope", "#a98a5c", "Lashings where straps should be, made from what the docks had."),
            ("Bell bronze", "#9c7437", "The sergeant's sash, and nothing else. His one saturated note, and the marker that has to carry his rank."),
        ],
        "notes": [
            "Three values on purpose. The first pass painted iron, wool and rope at "
            "almost the same mid warm grey and he read as one flat monochrome mass; he "
            "now has a pale field (the jack), a dark field (leather and boots) and a "
            "single accent, the way Ewald does.",
            "The value fix needed no geometry. On the knight body ONE cell covers the "
            "cuirass, arms, legs and the helmet, which is exactly why nothing could be "
            "separated: so the helmet's faces move to their own cell and the shared one "
            "is repainted as quilted cloth. A jack grown from his torso faces was tried "
            "first and cut, because a colour boundary that follows triangle edges came "
            "out as a sawtooth reading as tearing.",
            "The helmet needed surgery, not a repaint. Re-UV'ing the knight's bascinet "
            "fixed its colour and never its shape: a closed helm over a padded CLOTH "
            "jack is a kit that contradicts itself, and its crown ribs read as a spiked "
            "coronet whatever cell they sampled. So it is cut down to a town kettle "
            "hat, with the brim extruded straight off the cut rim (the helmet's own "
            "edge carried outward, with real thickness) and the ribs relaxed away. His "
            "face reads now, which the campaign needs, since he is the one who tells "
            "you what his line cannot kill.",
            "The brim then had to be filtered, not just extruded. The cut is a "
            "face-CENTRE test, so the rim it leaves steps by up to a whole face in both "
            "radius and height, and a radial push moves each vertex along its own "
            "direction: the brim did not merely inherit that sawtooth, it amplified it "
            "into the one edge that holds the silhouette. The rim is now low-passed "
            "around its own loop before anything is extruded and again per ring. A "
            "filter and not a circle fit, because the dome is offset and slightly oval "
            "and snapping it round would trade a sawtooth for a tin lid.",
            "A polearm was tried first, at length, and cut. A halberd is the right "
            "idea for a militia sergeant, since it was a literal badge of rank, and it "
            "does not fit this body: the grip sits 28 percent up the haft, so the head "
            "starts barely half a unit above the hand, while this figure's head and hat "
            "are 48 percent of its total height. Held upright the blade is inside his "
            "skull at every roll and scale; the only clearance is a hard lean outboard, "
            "which reads as a flagpole. A sword is the honest answer at these "
            "proportions, and the record of the attempt is in "
            "`docs/design/last-bell-polearm-carry.md`.",
            "The sword is carried a SIZE UP on the shared blade grip. At the bare "
            "family scale it measured smaller than the warden's arming sword, which "
            "inverts the one comparison that is supposed to run his way: everything "
            "else on him is the poorer of the two, and the blade is not.",
            "Separated from Coalfast at every level, because they share a body and stand "
            "two POIs apart: a town kettle hat against a bare head, no cloak against "
            "warden rust, warm town iron against cold salt-scoured steel, a bare "
            "off hand against a heavy square shield, and one pauldron on the RIGHT "
            "against a three-lame stack on the LEFT.",
            "Rank has to survive standing next to his own militia, who are built on the "
            "same body: the kettle hat, the right pauldron and a bell "
            "bronze sash. The sash takes over his diagonal lashing while the waist wrap "
            "stays hemp, so he gains a rank marker without losing the improvised "
            "repairs the character is built on.",
            "The sash is built at SASH width, which is the whole reason it works. Left "
            "at the rope width it inherited it was 0.6 percent of his surface area, and "
            "recolouring something that small marks nothing: a rank badge has to be big "
            "enough to survive a glance from across a road. Wide and thin now, ridden "
            "out onto the real chest so its edges cannot cut into the torso the way a "
            "flat ribbon does once it is wider than the curve it lies on.",
        ],
        "weapons": [
            {"url": "weapons/adv_sword_1handed.glb", "bone": "handslot.r",
             # CORRECTION (2026-08-05): the claim this comment used to make, that
             # `VisualDef.attach` mounts a one-hander with a bare bone attach and
             # no aiming rotation, is FALSE, and building the book's mounts on it
             # shipped the whole cast holding swords by the blade root. The engine
             # seats every held model through real grip transforms (`applyHandGrip`
             # / `applyVariantGrip` in `src/render/characters/assets.ts`), and this
             # model is itself misrouted there (`adv_sword_1handed` sits in the
             # VAR_SWORD accessory row but is KayKit-family geometry, so the game
             # seats it across the wrist).
             #
             # The shipped book renders no longer come from this entry: they carry
             # hand-authored seats, captured from a live Blender review pass and
             # gated across all four clips. The seats, the failure catalog, and
             # the authoring protocol live in
             # `docs/design/last-bell-held-prop-workflow.md`. Regenerating the
             # book from this entry WILL regress it until those seats are baked in.
             "grip": "blade", "tune": {"scale": 0.72},
             "why": "A big plain arming sword, town-forged: no fuller, no maker's mark, nothing on it a guild would sign. Carried a size up on the family grip so it reads heavier than the warden's, which is the one place his kit is not the poorer of the two."},
        ],
        "poses": [
            ("Idle", 7, "Holding the road"),
            ("Walking_A", 6, "Walking the line"),
            ("1H_Melee_Attack_Chop", 17, "The strike"),
            ("Block", 8, "Bracing the line"),
        ],
    },
    # -------------------------------------------------------------- the squad
    "coalfast": {
        "name": "Warden Coalfast",
        "title": "Redoubt Commander",
        "post": "The redoubt, Gullhaven",
        "entity_color": "#8a4b2b",
        "base": "knight.glb",
        "height_yards": HUMANOID,
        "role": "Shield-bearing front line and battlefield commands.",
        "blurb": (
            "Warm when he has time to be and frighteningly decisive when he does "
            "not. He has read Warden Hale's account of the last interior sealing "
            "more times than anyone alive, and has privately settled one thing: "
            "if the rite must be carried inside, the carrier will be him."
        ),
        "signature": (
            "The roll of names. A leather bandolier hung with small bronze "
            "name-plates, one for every defender he has lost. It rhymes forward to "
            "the plinth of seal-bearers Saul sends you to read in Q7, and to the "
            "five name-stones Nell carries to Willowfen after the finale."
        ),
        "palette": [
            ("Salt-scoured iron", "#9ba7a3", "Plate a wet island has been at for years."),
            ("Bell bronze", "#9c7437", "The Vigil's metal: the Bellheart, the bell, Hale's bronze."),
            ("Warden rust", "#8a4b2b", "His cloak, and literally his sim entity colour."),
            ("Star-glass", "#a9dcee", "The island's own material, at his throat."),
        ],
        "notes": [
            "Bare-headed at his post: the campaign asks you to love these people, "
            "and a face carries that where a bucket helm cannot.",
            "The bronze band is the warden's office. The crest that goes with it "
            "waits for the helm he puts on to go inside.",
        ],
        "weapons": [
            {"url": "weapons/sword_1handed.glb", "bone": "handslot.r", "grip": "blade",
             "why": "A warden's arming sword: island-forged, unremarkable, kept sharp."},
            {"url": "weapons/shield_square.glb", "bone": "handslot.l", "grip": "shield",
             "why": "The heavy square shield the front line is built around. He is the line."},
        ],
        "poses": CREW_POSES,
    },
    "coalfast_helm": {
        "name": "Warden Coalfast, sealed",
        "title": "Redoubt Commander, the breach",
        "post": "Inside the wound",
        "entity_color": "#8a4b2b",
        "base": "knight.glb",
        "height_yards": HUMANOID,
        "role": "The same man, going in.",
        "blurb": (
            "His finale form. The helm goes on to carry the rite inside, and with "
            "it the crest: the same fore-and-aft comb the bronze figure on Hale's "
            "column wears above the harbour steps. Every warden on this island grew "
            "up beneath that silhouette, and he is the next one to wear it."
        ),
        "signature": (
            "The crest, and where it comes from. It is not a promotion, it is a "
            "quotation: he has read Hale's account more times than anyone alive, "
            "and he puts on the same outline knowing exactly how that story ends."
        ),
        "palette": [
            ("Salt-scoured iron", "#9ba7a3", "The same harness, now closed."),
            ("Bell bronze", "#9c7437", "The crest, cast like the memorial's."),
            ("Warden rust", "#8a4b2b", "The cloak he does not come home in."),
            ("Star-glass", "#a9dcee", "The badge that will be one of five anchors."),
        ],
        "notes": [
            "One asset, two forms: the same body, atlas and clips, so the helm "
            "going on costs a swapped visual key and nothing else.",
        ],
        "weapons": [
            {"url": "weapons/sword_1handed.glb", "bone": "handslot.r", "grip": "blade",
             "why": "The same sword. Nothing about the last hour is newly equipped."},
            {"url": "weapons/shield_square.glb", "bone": "handslot.l", "grip": "shield",
             "why": "The shield he holds the wound shut behind."},
        ],
        "poses": CREW_POSES,
    },
    "ollun": {
        "name": "Riftwatch Ollun",
        "title": "Breach Scholar",
        "post": "The signal-fire vigil, Watch Meadow",
        "entity_color": "#3f5f8a",
        "base": "mage.glb",
        "height_yards": HUMANOID,
        "role": "Interrupts Rift effects and reads the changing anchor pattern.",
        "blurb": (
            "He can hear a breach change before it becomes visible, and he reads "
            "one the way a physician reads a chest. He designs the outer seal and "
            "genuinely hopes it will work; his calculations cannot prove that it "
            "will. Across the whole campaign he is the only squad member who never "
            "describes his own future."
        ),
        "signature": (
            "The instrument bandolier, and its empty loops. He gives his "
            "possessions away as the arc runs, so the strap that should hold a "
            "full set of star-glass instruments is missing more of them every time "
            "you see him. The gaps are the character: he suspected first, and said "
            "nothing, because hope was also a calculation."
        ),
        "palette": [
            ("Riftwatch slate", "#3f5f8a", "His sim entity colour, worn as the robe."),
            ("Star-glass", "#a9dcee", "Instruments, and what the seal is made of."),
            ("Old paper", "#e4d9c0", "The record that outlives him and reaches the Old Beacon."),
            ("Bell bronze", "#9c7437", "Instrument fittings, calibrated against the bell."),
        ],
        "notes": [
            "Hooded, and for a reason: the KayKit mage body wears long loose hair, "
            "which read as a woman at a glance. A hood settles it without touching "
            "the shipped head, and a man who keeps the signal-fire vigil in Farshore "
            "weather owns one. His hair is dark; nothing in the spec makes him old.",
            "No wizard hat. He is an instrument-keeper and a record-keeper, not a "
            "spellcaster, and the silhouette should not promise magic.",
            "The empty loops are authored asymmetrically, so the eye reads them as "
            "absence rather than as a pattern.",
        ],
        "weapons": [
            {"url": "weapons/brasscrown_walking_staff.glb", "bone": "handslot.r", "grip": "stave",
             "why": "A measuring staff he walks the Riftfields with, marked off in bell-lengths."},
            {"url": "tools/journal_open.glb", "bone": "handslot.l", "grip": "book",
             "why": "His record. It survives all five of them and travels to the parent order."},
        ],
        "poses": [
            ("Idle", 7, "Reading the breach"),
            ("Walking_A", 6, "Pacing the evacuation route"),
            ("Spellcast_Raise", 16, "Raising the outer seal"),
            ("Block", 8, "When the pattern divides"),
        ],
    },
    "edda": {
        "name": "Quartermaster Edda",
        "title": "Redoubt Armorer",
        "post": "The forge, Gullhaven redoubt",
        "entity_color": "#6b6b3a",
        "base": "rogue.glb",
        "height_yards": HUMANOID,
        "role": "Heavy ranged damage, demolitions and charge placement.",
        "blurb": (
            "She repairs the same battered equipment so often that she treats it "
            "like part of the family, and she names her machines. Abrasive, "
            "practical, and very funny when afraid: the more frightened she is, "
            "the funnier she gets. She voted to call the mainland for relief, and "
            "in Q6 it is her hand that puts the flare up."
        ),
        "signature": (
            "The charge rack. Star-glass charges she built herself, racked across "
            "her chest where she can reach them without looking. She stays at the "
            "charge station at the end for the reason she always gives, that only "
            "she can arm it, and never for the reason everyone else can see."
        ),
        "palette": [
            ("Forge olive", "#6b6b3a", "Her sim entity colour: workshop canvas, not livery."),
            ("Soot", "#2a2724", "Hands, forearms and hem. It does not wash out."),
            ("Star-glass", "#a9dcee", "The charges, ground and set by her own hand."),
            ("Bell bronze", "#9c7437", "Fittings, and the bell she helps reforge."),
        ],
        "notes": [
            "Soot is painted UP the forearms and DOWN the hem, the two places a "
            "forge actually marks, rather than as an even grime pass.",
            "Her tools read as maintained, not worn out. She is the reason the "
            "squad's gear outperforms the militia's.",
        ],
        "weapons": [
            {"url": "weapons/iron_field_hammer.glb", "bone": "handslot.r", "grip": "haft",
             "why": "The field hammer she rebuilds the redoubt's kit with. It has a name."},
            {"url": "tools/tongs.glb", "bone": "handslot.l", "grip": "tool",
             "why": "Forge tongs: how star-glass gets handled by someone who intends to keep her fingers."},
        ],
        "poses": [
            ("Idle", 7, "At the forge"),
            ("Walking_A", 6, "Carrying a charge"),
            ("1H_Melee_Attack_Chop", 17, "Setting the charge"),
            ("Cheer", 31, "Funniest when frightened"),
        ],
    },
    "saul": {
        "name": "Mender Saul",
        "title": "Field Surgeon",
        "post": "The wounded, Gullhaven redoubt",
        "entity_color": "#9a3b3b",
        "base": "mage_classic.glb",
        "height_yards": HUMANOID,
        "role": "Healing, cleansing dream-corruption, keeping the anchor holders alive.",
        "blurb": (
            "Gentle, exhausted, and harder to frighten than any of them. He made "
            "peace with the precedent before anyone else did, and he is the one who "
            "makes sure the newcomer understands the histories before the histories "
            "happen to them: it is Saul who sends you to read the statue's plinth."
        ),
        "signature": (
            "The mended apron. Every patch on it is stitched the way he ties a "
            "bandage, in the same over-and-back he has used on a thousand people, "
            "because he mends his own kit with the only hands he has. He treats "
            "every patient by name and has never once mentioned his own."
        ),
        "palette": [
            ("Mender's red", "#9a3b3b", "His sim entity colour. It hides what the work leaves."),
            ("Bandage linen", "#dfe3e2", "Clean, and rationed, and always the newest thing on him."),
            ("Worn leather", "#63482f", "An instrument roll older than most of the militia."),
            ("Star-glass", "#a9dcee", "What cleanses dream-corruption, and all he has of it."),
        ],
        "notes": [
            "Built on mage_classic, not the mage body: it carries a short dark cut "
            "and a plain male face where the mage body's long hair read as a woman. "
            "Same palette cells, same bone names, so the recipe is unchanged.",
            "Exhausted, not old. His hair stays dark; the tiredness is in the kit.",
            "The only figure whose authored detail is REPAIR rather than equipment. "
            "Everything about him is something kept working past its life.",
            "Lantern in the off hand, nothing in the main. He is the one person on "
            "the island whose hands are the tools.",
        ],
        "weapons": [
            {"url": "tools/lantern.glb", "bone": "handslot.l", "grip": "hang",
             "why": "He works among the wounded at night. The lantern is how they find him."},
        ],
        "poses": [
            ("Idle", 7, "With the wounded"),
            ("Walking_A", 6, "Called away"),
            ("Spellcasting", 12, "Cleansing the corruption"),
            ("Sit_Floor_Idle", 6, "The rest he does not take"),
        ],
    },
    "tam": {
        "name": "Bellkeeper Tam",
        "title": "Watchbell Keeper",
        "post": "The watchbell brazier, the Landing",
        "entity_color": "#4a7b6b",
        "base": "barbarian.glb",
        "height_yards": HUMANOID,
        "role": "Protective wards, crowd control, and the Bellheart's counter-note.",
        "blurb": (
            "Coalfast's oldest friend, and the only person who can reliably read "
            "and answer the Bellheart's changing tone. He uses humour to keep fear "
            "from becoming the most important person in the room, claims not to "
            "believe in the old Vigil rites, and knows every word of them. His "
            "silence is the alarm."
        ),
        "signature": (
            "The bell-striker, worn pale where his hand goes. It is the one object "
            "the campaign hands you afterwards as a keepsake, so it has to be "
            "recognisably HIS before you ever receive it: bronze head, leather "
            "haft, and sixty years of grip polished into the same four inches."
        ),
        "palette": [
            ("Watch teal", "#4a7b6b", "His sim entity colour: the bell-keeper's coat."),
            ("Bell bronze", "#9c7437", "More of it on him than on anyone. He is the bell's man."),
            ("Grip pale", "#9c7a4e", "Where the striker's leather has gone the colour of bone."),
            ("Weathered", "#d3a07a", "Forty years of standing at the causeway's end."),
        ],
        "notes": [
            "Built on the barbarian body for breadth, with the bear hat dropped. He "
            "is an old soldier's shape, not a warden's.",
            "The striker is bespoke geometry rather than a stock weapon, because no "
            "shipped model reads as a bell-striker and the keepsake has to match.",
        ],
        "weapons": [],
        "poses": [
            ("Idle", 7, "Listening"),
            ("1H_Melee_Attack_Chop", 17, "One toll for the fields"),
            ("Cheer", 31, "Keeping fear out of the room"),
            ("Block", 8, "Wards up"),
        ],
    },
    "nell": {
        "name": "Nell",
        "title": "Bell-runner",
        "post": "Between the posts and the tower",
        "entity_color": "#5a7a9a",
        "base": "rogue.glb",
        "height_yards": 2.25,
        "role": "Carries messages. Not part of the final expedition, and survives it.",
        "blurb": (
            "Bren's daughter. Her father's death is weeks old, she is terrified of "
            "the work, and she does it anyway: her courage is not the absence of "
            "fear, it is returning to the shore in spite of it. She helps evacuate "
            "Gullhaven, takes over the bell post afterwards, and is the person who "
            "later asks you to carry five name-stones to Willowfen."
        ),
        "signature": (
            "The tally cord. A knotted line at her hip, one knot for every run she "
            "has made since her father died, because counting them is how she keeps "
            "going back. It is the only piece of characterisation in the book that "
            "is a number."
        ),
        "palette": [
            ("Runner's blue", "#6e8ca8", "Her sim entity colour, and the lightest cloth on the island."),
            ("Salt canvas", "#bfae8e", "A satchel cut down from something of her father's."),
            ("Bell bronze", "#9c7437", "The hand-bell. Small, and the loudest thing she owns."),
            ("Rope", "#9c7a4e", "The tally cord, and the knots in it."),
        ],
        "notes": [
            "Shorter than every adult on the island (2.25 against 2.6). The scale "
            "chart is doing characterisation work here, not just documentation.",
            "No armour and no weapon. She is the only figure in the campaign whose "
            "job is to be somewhere else, fast.",
            "On the rogue body, not the ranger's: the ranger carries a moustache "
            "(it went to Ewald) and its quiver reads as a hunter, which is exactly "
            "what she is not. Youngest skin and hair in the book.",
        ],
        "weapons": [],
        "poses": [
            ("Running_A", 8, "Running the bell"),
            ("Idle", 7, "Waiting for the toll"),
            ("Cheer", 31, "Calling the code"),
            ("Hit_A", 6, "Going back anyway"),
        ],
    },
    # ------------------------------------------------------- through the breaks
    # Sizes are the SHIPPED numbers: VisualDef.height times MobTemplate.scale.
    # The comparison the scale chart makes is the useful one, and it is unflattering
    # in a deliberate way: almost nothing that comes through is bigger than a person.
    "riftspawn": {
        "name": "Riftspawn", "title": "Break-spawned", "post": "The island's fringe",
        "entity_color": "#7a3fb0", "base": "riftspawn_antler.glb", "kind": "spawn",
        "family": "demon", "levels": "3 to 4", "tint_strength": 0.35, "height_yards": 2.1 * 0.85,
        "role": "The common spill. Knows only the way it came and the thing in front of it.",
        "blurb": (
            "Whatever a rift is, it does not spill fishermen. Riftspawn are what "
            "already made it through and now roam away from the redoubt, and they "
            "are the twelve you kill in Q0 while the militia watches. The first "
            "enemy anyone fights on this island, which makes it the first thing "
            "that has to say what a rift is."
        ),
        "signature": (
            "It has no mouth. A narrow blank face, two cold eyes, and nothing else: "
            "this is a thing that does not eat and does not speak, which is a "
            "stranger idea than any set of teeth. Above it, antlers branch wider "
            "than its own body."
        ),
        "palette": [
            ("Rift violet", "#7a3fb0", "Its sim entity colour, and now the skin itself."),
            ("Deep bruise", "#3b2450", "The shadow value. Purple, never black."),
            ("Wound magenta", "#c2439a", "Edge accents where the body was cut wrong."),
            ("Cold eye", "#9fe4ee", "The only bright thing on it, and the family mark."),
        ],
        "notes": [
            "No longer a repainted skeleton. A skeleton is a DEAD body and the lore "
            "wants an unfinished one, so the whole approach changed: generated from a "
            "concept, then rigged onto the KayKit skeleton locally rather than "
            "retargeted, which is why it carries all 22 native clips.",
            "Four arms, and they cost nothing. The lower pair is bound rigidly to the "
            "chest bone, so it rides the torso through every clip: no new bones, no "
            "per-clip posing. Only free-swinging extra limbs are expensive.",
            "The arm bone chain sat at z 1.107 while all four arms lived between 0.69 "
            "and 0.96, so Walking_A dragged the lower pair inward and tangled it. The "
            "fix was to drop the chain onto the upper pair's real line: editing the "
            "REST pose is safe, because rest is the bind, so the mesh does not move "
            "but every clip now rotates the arm about a pivot inside the geometry.",
        ],
        "weapons": [],
        # The swipe is the plate that matters for this figure, so it is pinned rather
        # than auto-picked: the diagonal slice is the widest reach its arms make, and
        # the clip's own rotations were amplified so it reads as violent at gameplay
        # distance instead of a polite human chop.
        "poses": [
            ("Idle", 7, "Waiting at the fringe"),
            ("Walking_A", 6, "Coming through"),
            # Both authored attacks, because they are different shapes and the point of
            # authoring them was that four arms should read as one committed blow.
            ("1H_Melee_Attack_Chop", None, "The rake, all four arms"),
            ("1H_Melee_Attack_Slice_Diagonal", None, "The swipe, upper pair over the top"),
            ("Hit_A", None, "Struck"),
        ],
    },
    "breach_wretch": {
        "name": "Breach Wretch", "title": "Break-spawned", "post": "The island's fringe",
        "entity_color": "#5a4a78", "base": "skeleton_rogue.glb", "kind": "spawn",
        "family": "kobold", "levels": "3 to 5", "tint_strength": 0.2, "height_yards": 2.1 * 0.9,
        "role": "The small ones come in numbers, and they come fast.",
        "blurb": (
            "Wretches are the pressure the redoubt lives under between the big "
            "nights: quick, many, and willing. They carry the breakscarred steel "
            "Edda asks you to bring back."
        ),
        "signature": (
            "A low, quick, hooded silhouette. Nothing about one of them is "
            "frightening, which is exactly the point: they are the pressure the "
            "redoubt lives under between the big nights."
        ),
        "palette": [
            ("Void bone", "#bfb6c8", "The same bleached frame, smaller."),
            ("Bruise violet", "#5a4a78", "Its sim entity colour, worn as the hood."),
            ("Star-glass", "#a9dcee", "Three small shards. It has not been through as much."),
        ],
        "notes": [
            "Rebuilt off the KayKit skeleton rogue: hooded and low, so a pack of them "
            "reads as a crowd rather than as five copies of one threat. The flat "
            "Quaternius goblin it replaced read as neither.",
        ],
    },
    "void_stalker": {
        "name": "Void Stalker", "title": "Break-spawned", "post": "The edge of the watchfires",
        "entity_color": "#2f2a44", "base": "wolf_basic.glb", "kind": "creature",
        "family": "beast", "levels": "5 to 6", "tint_strength": 0.35, "height_yards": 1.6 * 1.15,
        "role": "Hunts the edges of the light the watchfires throw.",
        "blurb": (
            "The reason the island keeps its fires burning at the perimeter rather "
            "than the centre. It does not test a lit line; it waits for one to gutter."
        ),
        "signature": (
            "That it chooses where to hunt. It does not test a lit line; it waits for "
            "one to gutter, which is why the island keeps its fires at the perimeter "
            "rather than the centre."
        ),
        "palette": [
            ("Starless", "#2f2a44", "Its sim entity colour, applied the way the renderer applies it."),
            ("Wolf coat", "#8c8270", "The baked texture underneath, kept and darkened."),
        ],
        "notes": [
            "Kept on the wolf body: it is the only quadruped in the kit that holds up "
            "at this size, and a stalker needs four legs. Re-coloured exactly the way "
            "`tintedMaterial` does it at runtime, so the plate matches the game.",
            "OPEN: star-glass dorsal shards were built and CUT. At every offset tried "
            "they read as pale ice spikes standing off the back rather than glass grown "
            "through it. The tint alone already carries it, so the mark it shares with "
            "the skeleton spawn is missing here, and that is a follow-up.",
        ],
        "shards": 4, "shard_len": 0.155, "shard_base": 0.032,
    },
    "tidemill_stalker": {
        "name": "The Tidemill Stalker", "title": "Q0 boss, elite",
        "post": "The Tidemill, Watch Meadow",
        "entity_color": "#3a4a2f", "base": "spider.glb", "kind": "creature",
        "family": "beast", "levels": "5, fixed", "tint_strength": 0.35, "height_yards": 1.4 * 1.5,
        "role": "Demonstrates the gap between the player and the militia.",
        "blurb": (
            "It dug into the mill and it is wearing the miller's roof. This is the "
            "first thing on the island the militia cannot put down, which is the "
            "whole job of the fight: Marsh points at you, nothing follows you in, "
            "and the kill is yours alone. Coalfast recruits you off the back of it."
        ),
        "signature": (
            "The roof it should be wearing. The campaign says it dug into the mill "
            "and came out carrying the miller's roof, and that is what this boss "
            "ought to look like."
        ),
        "palette": [
            ("Mill moss", "#3a4a2f", "The sim entity colour, applied as a runtime tint."),
            ("Tidemill slate", "#5c6470", "Roof it has not shed."),
        ],
        "notes": [
            "Mapped onto the spider body rather than the beast family's wolf: the "
            "encounter reads through burrowing and webbed exits, and a wolf "
            "silhouette promises neither.",
            "OPEN: the carried mill roof is NOT modelled. Slate courses were "
            "prototyped and cut. The spider is a compact thorax under a wide leg span, "
            "and every seating of the slate read as a floating shelf rather than "
            "carried wreckage. Shipping a plate that misrepresents the model is worse "
            "than naming the gap, so it carries star-glass for now and the roof is a "
            "follow-up, not a delivery.",
        ],
        "shards": 3, "shard_len": 0.175, "shard_base": 0.036,
        "weapons": [], "poses": [],
    },
    "sundered_horror": {
        "name": "The Sundered Horror", "title": "World elite",
        "post": "The Sundered Cliffs",
        "entity_color": "#8a2f6a", "base": "sundered_horror_thicket.glb", "kind": "spawn",
        "family": "ogre", "levels": "7, fixed", "tint_strength": 0.2, "height_yards": 2.8 * 1.45,
        "role": "The biggest thing the cliffs' break ever let through.",
        "blurb": (
            "The island's high-water mark for what a break can deliver, and the only "
            "figure in this book that stands taller than a person. Everything the "
            "squad says about this year being the worst in living memory is "
            "measured against things like this arriving more often."
        ),
        "signature": (
            "The crown of horns. Not two horns but a thicket of them, uneven, growing "
            "out of the skull in every direction and half burying the face underneath. "
            "At four yards it is the only figure in this book that stands taller than "
            "a person, and the horns are what you see first."
        ),
        "palette": [
            ("Wound magenta", "#8a2f6a", "Its sim entity colour, and the flush along its flanks."),
            ("Brute violet", "#5c3474", "The hide. Heavy, saturated, never grey."),
            ("Horn shadow", "#2e1c3c", "Deep purple in the horn thicket, holding the silhouette."),
            ("Cold eye", "#9fe4ee", "The family mark, shared with the Riftspawn."),
        ],
        "notes": [
            "Off the KayKit skeleton golem, which read as forged, fitted, painted "
            "armour and therefore implied a smith and a culture: exactly wrong for "
            "something a break spat out. A horned brute implies nobody made it.",
            "Rigged locally onto the KayKit skeleton like the Riftspawn, which "
            "upgrades it from the golem's EIGHT clips to the full set: it has block, "
            "cast, strafes and a jump for the first time.",
            "Generated twice. The first pass posed its heavy arms hanging to the "
            "ground, which is not a T-pose, so the local rig fitted its arm line to "
            "the reference wrist line and scaled it 21x: Walking_A shredded the head. "
            "Regenerating the same design in a T-pose cost 55 cents and tamed the "
            "worst of it; the head and horns were only properly owned by the head "
            "bone once the weight solver grew a real length scale (see "
            "docs/design/sundered-horror-rig-audit.md).",
            "Its blow is a SWEEP, never the two-handed overhead chop. Its arms are "
            "stubby against a torso half as wide as the whole figure, so the arm bone "
            "chain sits buried inside the body mass and there is no elbow in the open "
            "to articulate: rotating the arm harder achieves nothing. The clips were "
            "re-authored the other way round instead, damping the torso pitch and "
            "amplifying the shoulders, so the mass leans into a low wide claw sweep "
            "and keeps its eyes on the target rather than folding over its own head.",
        ],
        "poses": [
            ("Idle", 7, "At the cliffs"),
            ("Walking_A", 6, "Coming down the slope"),
            # The haymaker first: it is the wide horizontal arc, and the whole reason the
            # arm rig was rebuilt was that this creature could not swing from the shoulder.
            ("1H_Melee_Attack_Chop", None, "The haymaker, shoulder through the arc"),
            ("1H_Melee_Attack_Slice_Diagonal", None, "The sweep, over the top"),
            ("Hit_A", None, "Struck"),
        ],
    },
}
