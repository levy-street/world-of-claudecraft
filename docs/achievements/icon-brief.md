# Icon brief: new deeds (2026-07-09)

Ready to send. One line per new deed, same format as the v1 brief; icon files
are named exactly by deed id at 512x512 RGBA like the existing set. All six
transcribed ids ship with the procedural category crest as fallback until art
arrives. The two deferred salvage ids are listed at the end, marked, so the
whole batch can be commissioned in one sitting (deferred art joins the
existing 11 orphans until their deeds transcribe).

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
procedural chronicle category crest as fallback until art arrives (the Icons
authoring rule in `docs/design/deeds.md`), and both are enumerated once as
`DEED_ART_PENDING` in `src/ui/icons.ts`, which
`tests/deed_icons.test.ts`, `tests/missing_painted_icons_wave.test.ts` and
`tests/release_v034_additional_art.test.ts` all read, so removing an id there is
the single edit that lands with the ingested crest.

Chronicle:
- [v1] `chr_drakemaw_broodlord`, Clutch Breaker: a cracked dragon egg in a scorched nest, a broken broodlord horn laid across the shell, ember orange on slate.
- [v1] `chr_maw_matriarch`, The Sky Goes Quiet: a wide dragon wing folding over a crater rim, a single fleck of ash falling through cold dusk light.
