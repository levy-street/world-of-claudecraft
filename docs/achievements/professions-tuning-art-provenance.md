# Professions tuning art provenance (2026-08-01)

This pass replaces the 13 temporary derived item icons introduced by the
professions tuning packet and supplies painted crests for the five deed records
added on the branch. All 18 paintings were created with OpenAI built-in image
generation from references already licensed for and shipped by World of
ClaudeCraft. Most references are project-owned or project-generated. Three
CraftPix Premium item icons were also supplied as licensed references:
`simple_fishing_pole` for the two rods, `grubjaw_tusk` for
`chr_marsh_rares_ii`, and `old_cragmaws_pelt` for `chr_peaks_rares_ii`. The
CraftPix source-pack lineage remains recorded in the historical owner and reference records under
`docs/achievements/item-art-consistency-2026-08-09/`; the three live icons now belong to that
replacement batch in `public/ui/items/mapping.json`.
No unlicensed external or proprietary-game art was used.

The shipping item WebPs and their batch prompts are recorded in
`public/ui/items/mapping.json`. Item sources were generated as opaque square
paintings, inspected at 128px and 28px, then converted with
`npm run assets:items -- --quality 82`. The nine fine materials reference their
matching base material plus same-family peers. The two rods reference the
Simple, Ironreel and Silverstream rod paintings for composition. The two charms
reference the arcane reagent family and the project's physical talisman icons.

## Deed crest prompt contract

Shared direction for every crest:

- Complete, centered, hand-painted classic dark-fantasy MMORPG medallion.
- Blackened bronze or steel body, antique-gold double rim, exactly four small
  cardinal kite points, and a dark enamel inset.
- Badge occupies about 78 percent of the square with no text, ribbon, extra
  frame, crop, watermark, exterior shadow or exterior glow.
- A flat chroma exterior absent from the subject is removed locally, producing
  a reviewed 512x512 RGBA source. `npm run assets:deeds --
  tmp/imagegen/professions-deeds` creates the committed 128px WebP and
  regenerates `src/ui/deed_image_ids.ts`.

Per-crest subject direction and in-repository references:

- `chr_peaks_gatherer`: an equally readable triad of violet-banded Osmium ore,
  an amber-faced Highpine log and one five-petal Sunpetal bloom against icy
  Thornpeak stone. References: `chr_vale_gatherer`, `chr_marsh_gatherer`,
  `chr_peaks_rares`, `thorium_ore`, `elderwood_log`, and `sunpetal_herb`.
- `chr_marsh_rares_ii`: a painterly Grubjaw trophy portrait with a moss-green
  glutton head, blue-black crest, broad hungry maw and ivory tusks, with only
  restrained marsh reeds and mist. References: `chr_marsh_rares`, `grubjaw`,
  and `grubjaw_tusk`.
- `chr_peaks_rares_ii`: a balanced diagonal pairing of Old Cragmaw's scarred
  charcoal pelt and claw with Shardlord Kazzix's faceted ice-blue rime heart.
  References: `chr_peaks_rares`, `exp_peaks_wayfarer`, `old_cragmaw`,
  `old_cragmaws_pelt`, and `shardlord_kazzix`.
- `chr_gleamstag`: one serene pale lilac-silver stag bust turning back in a
  hidden violet grove, with enormous luminous antlers as the main silhouette.
  References: `chr_vale_packbreaker`, `chr_vale_rares`, and `gleamstag`.
- `chr_hollow_rares`: an equal paired emblem with Old Marrowshell's blue-violet
  crystalline shell and claw below Aurelhorn's golden stag head and antlers.
  References: `chr_vale_rares`, `chr_peaks_rares`, `old_marrowshell`, and
  `aurelhorn`. Its accepted source received a 16px downward canvas translation
  after generation so the shipping alpha bounds center exactly at 128px.

The five shipping crests are gate-pinned for transparent padding, alpha bounds,
center, coverage, dimensions, decoding, weight and byte uniqueness in
`tests/deed_icons.test.ts`. The item gate literal-pins all 13 replacements and
rejects the exact hashes of their retired placeholders.

## Phase 20 bottom-map chronicle crests (2026-08-02)

The phase 20 density pass appends the six bottom-map chronicle deeds
(gatherer and first-cast pairs for the Willowfen, the Galecrest, and the
Farshore). Their crests follow the same shared prompt contract above, one
distinct OpenAI built-in image generation call per accepted asset, flat
removable chroma exterior, keyed and centered to reviewed 512x512 RGBA
sources, then
`npm run assets:deeds -- tmp/imagegen/professions-deeds` for the committed
128px WebP and the `src/ui/deed_image_ids.ts` regen.

Per-crest subject direction and in-repository references:

- `chr_willowfen_gatherer`: an equally readable triad of violet-banded ore, a
  pale willow log, and one five-petal Sunpetal bloom against dark fen water
  and reed silhouettes. Actual call references: `chr_marsh_gatherer`,
  `thorium_ore`, `elderwood_log`, and `sunpetal_herb`.
- `chr_willowfen_first_cast`: one silver trout rising through a ring of lily
  pads under lantern light, restrained fen mist. References:
  `chr_marsh_first_cast`, `chr_vale_first_cast`, and `raw_mirror_trout`.
- `chr_galecrest_gatherer`: the same gatherer triad staged on windswept
  headland grass with a low stone-wall hint. Actual call references:
  `chr_peaks_gatherer`, `thorium_ore`, `elderwood_log`, and `sunpetal_herb`.
- `chr_galecrest_first_cast`: a taut fishing line breaking one mirror-still
  tarn circle beneath grey downs sky. References: `chr_peaks_glimmer_cast`,
  `chr_vale_first_cast`, and `raw_river_perch`.
- `chr_farshore_gatherer`: the gatherer triad of grey iron ore, an ash-pale
  log, and one gold-leaf sprig against strand sand and causeway stones.
  Actual call references: `chr_vale_gatherer`, `iron_ore`, `ashwood_log`, and
  `goldleaf_herb`.
- `chr_farshore_first_cast`: one koi-bright fish arcing over mere water with
  two white gulls wheeling above. References: `chr_vale_first_cast`,
  `chr_marsh_first_cast`, and `glimmerfin_koi`.

The initial Willowfen proof pair was rejected because its cardinal points were
too long. The second gatherer attempt was rejected because the Sunpetal had six
petals; its separately generated third attempt has exactly five. The second
first-cast attempt was accepted after tightening the common frame geometry.
Useful rejected proofs remain in the gitignored worktree source area.

The accepted masters were copied under
`tmp/imagegen/release-v034-additions/masters/deeds/`. Their flat magenta
exteriors were removed with the imagegen skill helper using `--auto-key border`,
`--soft-matte`, `--transparent-threshold 24`, `--opaque-threshold 96`, and
`--despill`. Original interior pixels were restored beneath a closed and eroded
subject mask so magenta-like in-medallion accents remained opaque while the
helper's soft, despilled edge was preserved. The resulting sources were
centered deterministically in 512px sRGB canvases. The Galecrest first-cast
cutout received a final uniform fit correction to keep its circular body and
cardinal points centered after the alpha pass.

Exact accepted prompts, repository-reference roles and licences, source and
shipping hashes, alpha geometry, processing steps, and review sheets are
recorded in `docs/achievements/release-v034-additional-art.json`.
