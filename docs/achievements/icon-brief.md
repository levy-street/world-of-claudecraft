# Icon brief: new deeds (2026-07-09)

> Completed 2026-08-10: every live deed now has committed painted art. The final 30-crested
> completion wave is recorded in `placeholder-art-completion-2026-08-09/README.md` and
> `placeholder-art-completion-2026-08-09/accepted-art.json`. The nine later Reliquary crests are
> recorded in `release-art-audit-v036-2026-08-10/reliquary-deed-art.md`.
> `DEED_ART_PENDING` is empty.

Ready to send. One line per new deed, same format as the v1 brief; icon files
are named exactly by deed id at 512x512 RGBA like the existing set. The original
six transcribed ids used their procedural category crests while commissioning
was in progress; every live id now resolves to accepted painted art. The two
deferred salvage ids are listed at the end, marked, so the whole batch can be
commissioned in one sitting when their deeds transcribe.

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
