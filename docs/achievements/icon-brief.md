# Icon brief: new deeds (2026-07-09)

> Completed 2026-08-10: every live deed then had committed painted art. The final 30-crested
> completion wave is recorded in `placeholder-art-completion-2026-08-09/README.md` and
> `placeholder-art-completion-2026-08-09/accepted-art.json`. The nine later Reliquary crests are
> recorded in `release-art-audit-v036-2026-08-10/reliquary-deed-art.md`.
> Later content reopened `DEED_ART_PENDING` to 20 rows. Updated 2026-09-02: the
> Masterwrought art completion painted its 10 rows, leaving 10 inherited release-base rows in
> `src/ui/icons.ts`: the two walk-in castles, two bank sockets, Proving Shore graduation, and
> five Crucible deeds. The completed Masterwrought set and its provenance are recorded in
> `masterwrought-art-completion-2026-09-02/accepted-art.json`.
> Updated 2026-09-05: the hidden Forgebreaker celebration adds one pending crest,
> bringing the ledger to 11. Its commission brief is at the end of this file.

Ready to send. One line per new deed, same format as the v1 brief; icon files
are named exactly by deed id at 512x512 RGBA like the existing set. The 11 rows
named above still use their procedural category crests while commissioning is
in progress; every Masterwrought deed resolves to accepted painted art. The two
deferred salvage ids are listed at the end, marked, so they can be commissioned
when their deeds transcribe.

Progression:

- [v1] `prog_callused_hands`, Callused Hands: a work-worn open hand, palm up, over a crossed pick and herb sprig; warm first-trade browns.
- [v1] `prog_tools_of_the_trade`, Tools of the Trade: a masterwork workbench anvil with a finished gleaming tool laid across it, faint forge glow.
- [v1] `prog_crown_below`, The Crown Below: a tarnished royal crown half sunk in barrow earth, one shaft of cold light from above.
- [v1] `prog_mere_at_rest`, The Mere at Rest: a still moonlit lake surface with a single fading ripple ring, deep blue night palette.

Dungeon:

- [v1] `dgn_nythraxis_crypt`, What the Crypt Kept: two interlocking keystone halves framing a small worn leather diary, crypt-green shadow.

Chronicle:

- [v1] `chr_marsh_first_cast`, Eels in the Reeds: a taut fishing line vanishing between marsh reeds, a pale eel silhouette curling below the waterline.

Deferred (authored, not yet shipped; commission whenever convenient):

- [v1] `soc_first_salvage`, Nothing Wasted: a sword mid-break, splitting into neat squared material fragments over a workcloth.
- [v1] `soc_salvage_50`, Scrapmonger: a heaped wicker basket of salvaged fittings, buckles, and scrap plates, one plate stamped with a maker's mark.

## Drakelands brood rework (2026-08-04)

Two new ids from the dragonkin brood rework (`feature/dragonkin-drakelands`),
same delivery contract as above: one 512x512 RGBA PNG per deed, named exactly by
deed id, ingested with `npm run assets:deeds <source-dir>`. Both ship with the
procedural chronicle category crest as an authoring-time fallback (the Icons
authoring rule in `docs/design/deeds.md`). Their painted crests landed in the
2026-08-09 completion wave and `DEED_ART_PENDING` is now empty.

Chronicle:

- [v1] `chr_drakemaw_broodlord`, Clutch Breaker: a cracked dragon egg in a scorched nest, a broken broodlord horn laid across the shell, ember orange on slate.
- [v1] `chr_maw_matriarch`, The Sky Goes Quiet: a wide dragon wing folding over a crater rim, a single fleck of ash falling through cold dusk light.

## WARFARE lifetime-honor rank titles (2026-08-06)

Three new ids from phase 3 of the WARFARE tier refactor
(`feature/warfare-tier-refactor`), same delivery contract as above: one 512x512
RGBA PNG per deed, named exactly by deed id, ingested with
`npm run assets:deeds <source-dir>`. All three retain the procedural pvp category
crest as an authoring-time fallback (the Icons authoring rule in
`docs/design/deeds.md`), but their painted crests landed in the 2026-08-09
completion wave and `DEED_ART_PENDING` is now empty.

These are a LADDER, so the three should read as one ascending set: the same
insignia language and the same field palette, gaining metal and rank as they
climb (weathered iron, then steel and gold, then full gilt). Each carries a
title, so the crest is what a player displays their rank with.

PvP: the three deed IDS below are FROZEN (an earned title is stored as its deed id,
so a rename is display-only); their display names were re-cut off the classic-era
ranks they originally copied, hence id and name no longer match.

- [v1] `pvp_honor_sergeant`, Linebreaker: a splintered shield wall breached at its centre, one iron-shod boot planted through the gap, worn leather and muddied field browns.
- [v1] `pvp_honor_knight_lieutenant`, Fieldreaver: a reaping blade dragged low over trampled banners and broken shafts, a season of campaign behind it, steel blue and tarnished gold.
- [v1] `pvp_honor_field_marshal`, Warcrowned: a battered circlet forged from broken weapons, seated on a bare war standard, deep crimson field, high gold gleam.

## Reliquary release completion (2026-08-10)

These nine crests arrived after the 2026-08-09 completion wave. Each ships as a centered,
transparent painted deed medallion through the standard 512px intake and 128px WebP pipeline.
Exact prompts, ordered references, generated-output paths, processing, hashes, geometry, and
small-size review evidence live in
`release-art-audit-v036-2026-08-10/reliquary-deed-art.md` and its sibling JSON records.

Collection, Curator ladder:

- [v1] `col_reliquary_rank_2`, Spoilskeeper: a practical bronze reliquary coffer holding an early collection of relic tokens, with a slim curator key.
- [v1] `col_reliquary_rank_3`, The Cataloguer: an open midnight-blue catalogue ledger, silver key, magnifying lens, and an ordered arc of collection seals.
- [v1] `col_reliquary_rank_4`, Arch-Curator: a ceremonial vault-key staff crossed over a many-drawered relic cabinet, crowned by an archival seal.
- [v1] `col_reliquary_rank_5`, Eternal Spoils: a magnificent open gilt reliquary beneath a struck-gold eternal-knot seal and a binding loop of light.

Collection, completion ladder:

- [v1] `col_reliquary_complete`, The Grand Reliquary: open vault doors revealing a beautifully ordered grand collection beneath a museum-like gold halo.
- [v1] `col_reliquary_conquerors`, Shelf of Conquerors: a stone-and-gilt trophy shelf displaying champion arms, armor, horn, medallion, and banner.
- [v1] `col_reliquary_illum_nythraxis_heroic`, Nythraxis Illuminated: a blank illuminated manuscript bearing a crowned skeletal warlord emblem in violet-black flame and gold leaf.
- [v1] `col_reliquary_illum_thunzharr`, Thunzharr Illuminated: a blank illuminated manuscript bearing the split Waking Peak and a single blue-white lightning strike.
- [v1] `col_reliquary_illum_gravewyrm_heroic`, Sanctum Illuminated: a blank illuminated manuscript bearing a regal skeletal dragon emblem in bone, blue enamel, and gold leaf.

## The walk-in castle crests (2026-08-08)

Two new ids from the castle content pass, same delivery contract as above: one
512x512 RGBA PNG per deed, named exactly by deed id, ingested with
`npm run assets:deeds <source-dir>`. Both ride the procedural exploration
category crest until the paintings land (enumerated in `DEED_ART_PENDING`,
`src/ui/icons.ts`).

Exploration (the walk-in castles):

- [v1] `exp_the_last_keep`, The Quiet Halls: the Last Keep's gatehouse arch half in shadow, one banner stirring in a cold draught, dusk grey on ember red.
- [v1] `exp_dawnhold_castle`, An Open Door in the Garden: Dawnhold's garden gate standing open, petals drifting across the threshold, warm morning gold on hedge green.

## The bank socket crests (2026-08-20)

Two new ids from Bank Storage phase 06 (the bank bag socket ladder), same
delivery contract as above: one 512x512 RGBA PNG per deed, named exactly by
deed id, ingested with `npm run assets:deeds <source-dir>`. Both ride the
procedural social category crest until the paintings land (enumerated in
`DEED_ART_PENDING`, `src/ui/icons.ts`).

Social (the Gilded Strongbox socket ladder):

- [v1] `soc_strongbox_outfitter`, Strongbox Outfitter: a sturdy leather bag being fitted into a brass-rimmed socket inside an open strongbox, one gold coin on the ledge, banker green on brass.
- [v1] `soc_four_bags_deep`, Four Bags Deep: four matched bags seated in a row of brass sockets across a grand vault shelf, a wax-sealed bill of sale hanging below, deep green on gilt.

## The Proving Shore graduation crest (2026-08-17)

One new id from the tutorial island pass, same delivery contract as above: a
512x512 RGBA PNG named exactly by deed id, ingested with
`npm run assets:deeds <source-dir>`. It rides the procedural progression
category crest until the painting lands (enumerated in `DEED_ART_PENDING`,
`src/ui/icons.ts`).

Progression (the tutorial island):

- [v1] `prog_ready_for_an_adventure`, Ready for an Adventure: the island ferry bell mid-swing against a dawn strait, the Proving Shore small behind it, rope trailing toward an unseen hand, sea teal on brass gold.
- [v1] `prog_legendmaker`, The Legendmaker (Masterwrought, the orange promotion): a finished apex piece on an anvil catching a legendary orange glow, a signed Deed of Making beneath it with its wax seal cracked, a quill laid across the parchment, ember orange on iron black.

Item icons (the tutorial island's two interact props): shipped as renders of
their own world models (`scripts/render_island_item_icons.mjs`), so no
commission is outstanding. Optional repaint briefs if the set ever gets a
painted pass:

- [v1] `ps_castaway_crate`, Castaway Crate: a salt-bleached slat crate bound in tarred rope, one plank sprung, sand still in its seams.
- [v1] `ps_ferry_bell`, Ferry Bell: a brass dockside bell on a weathered post bracket, rope pull knotted twice, morning light off the rim.

## The Masterwrought angling crest (2026-09-02)

One collection crest from the Masterwrought high-band fishing pass, under the
same 512x512 RGBA delivery contract as the other deed paintings.

- [v1] `col_deepest_cast`, The Deepest Cast: a Clockreel Fishing Rod casting a taut luminous line into a deep teal whirlpool, the reel's brass cogs catching one pale highlight above abyssal blue water.

## The farming celebration crests (2026-08-18)

Seven new ids from the farming celebrations pass (D13), same delivery contract
as above: one 512x512 RGBA PNG per deed, named exactly by deed id, ingested
with `npm run assets:deeds <source-dir>`. Six of the seven ride their
procedural category crests until the paintings land (enumerated in
`DEED_ART_PENDING`, `src/ui/icons.ts`); `prog_farming_100` is the exception,
shipped with a COMMITTED interim crest because the Reliquary title shelf
forbids fallback art for title deeds (see its row's NOTE below).

Progression and chronicle (the planting and first-harvest line):

- [v1] `prog_first_planting`, Sow It Begins: a single seed dropped into a fresh furrow from an open hand, morning light on turned earth.
- [v1] `chr_vale_first_harvest`, First Fruits of the Vale: a wicker basket of ripe vegetables against rolling green meadow and a distant mill, warm valley daylight.
- [v1] `chr_marsh_first_harvest`, Sprouts in the Peat: bright young shoots standing in dark peaty soil, mist and reed silhouettes behind, bog green on umber.
- [v1] `chr_peaks_first_harvest`, A Crop Among the Crags: a hardy barley sheaf lashed to a stone cairn on a windswept ledge, thin mountain sky.
- [v1] `chr_evergarden_first_harvest`, A Plot in Paradise: a tidy raised bed overflowing with produce beneath drifting petals, lush garden light.

Collection (the rare-find family):

- [v1] `col_golden_harvest`, Golden Harvest: one impossibly golden gourd glowing amid ordinary crops, radiant sunburst rays on harvest amber.
- [v1] `col_farm_roster`, Every Furrow Filled: a quartered crop field bearing four distinct harvests inside a simple grain-and-leaf wreath, rich earth brown under seasonal green and harvest gold.

Progression (the profession milestone):

- [v1] `prog_farming_100`, Harvestmaster: a crossed hoe and sickle over a ribbon-tied wheat crown, proud guild-seal framing in bronze and gold. NOTE: an interim tied-wheat-sheaf medallion crest is COMMITTED with the phase (the Reliquary title shelf forbids fallback art for title deeds, so this one could not ride the pending ledger); the commissioned piece replaces it through the normal converter run.
- [v1] `prog_field_to_feast`, From Field to Feast: a cultivated furrow and fresh greens flowing into a generous communal feast platter, a garden hoe and cook's ladle crossed behind it, earth green warming into hearth gold.

## The Crucible of the Last Spring raid crests (2026-08-29)

Five new ids from the Ignivar raid deeds pass (the loot PRD's obligations
closeout), same delivery contract as above: one 512x512 RGBA PNG per deed,
named exactly by deed id, ingested with `npm run assets:deeds <source-dir>`.
All five ride the procedural dungeon category crest until the paintings land
(enumerated in `DEED_ART_PENDING`, `src/ui/icons.ts`).

Dungeon (the Crucible of the Last Spring raid):

- [v1] `dgn_ignivar`, The Herald Falls: Ignivar's molten herald mask cracked through and going dark, sparks dying above sealed spring waters, forge orange on iron black.
- [v1] `dgn_ignivar_heroic`, Heroic: The Herald Falls: the same cracked herald mask ringed by a gold heroic laurel, its last ember caught inside the wreath.
- [v1] `dgn_varkhul`, The Forge Goes Cold: Varkhul's great anvil under a raised silent hammer, the forge glow fading to blue-grey ash, one thin line of spring water cutting through the coals.
- [v1] `dgn_varkhul_heroic`, Heroic: The Forge Goes Cold: the cold anvil and hammer ringed by a gold heroic laurel, frost creeping over the anvil face.
- [v1] `dgn_varkhul_flawless`, Not One Ember Lost: ten unbroken candle flames in a ring above the forge floor, none guttering, warm gold on deep bronze.

## The self-crafted Forgebreaker celebration (2026-09-05)

One hidden, zero-Renown deed from the one-time hammer quest. It uses the existing
procedural hidden-category crest until an accepted painting lands, explicitly
tracked in `DEED_ART_PENDING` in `src/ui/icons.ts`. Deliver
`hid_forgebreaker.png` as a centered 512x512 RGBA medallion with genuinely transparent
exterior pixels, then ingest with `npm run assets:deeds <source-dir>`. Do not paint a
checkerboard into the background: both initial generated candidates failed that
alpha requirement and are not shipping art. The quest reagent has its own accepted
item icon; this commission is only for the deed crest.

Hidden (the one-time Forgebreaker shaping):

- [v1] `hid_forgebreaker`, A Spring Unchained: a finished dark-iron two-handed hammer over a broken forge chain, a single clear spring-water ribbon flowing through its open links; restrained ember-orange highlights against cool spring blue, framed as a readable medallion with no text, letters, watermark or background plate. Keep the hammer head and broken link legible at 32px and 48px; transparent exterior, never a painted checkerboard.
