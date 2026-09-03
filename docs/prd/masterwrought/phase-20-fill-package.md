# Phase 20 fill package (the STEP 1 derivation, 2026-09-02, at 103934491b)

The complete fill set the release-tier pass must close, re-derived at execution from the
registry AND from every source the registry cannot see. Counts are measured at the tip
named above; every list below is the mechanical output, not a remembered figure. The
maintainer's STEP 1 decisions are collected at the end.

## How it was derived

- The registry: `TURBO_FORCE=1 npm run i18n:gen` then `npm run i18n:worklist` at the tip,
  byte-identical to the committed summary (pending 14,290).
- The ledgers: 67 read-only reader lanes, one per release-fill block, over every
  case-insensitive `release-fill` / `release fill` mention in state.md (94 hits), farming/state.md
  (15) and the QA and rulings docs (23), plus the two flagged-fills tables of phase-19f-qa.md and
  phase-19g-qa.md: 517 structured entries and 237 recorded defects (count inconsistencies,
  unnamed keys resolved from the tree, keys that no longer exist), then a completeness critic
  over the merged list. The live-versus-superseded split is the readers' own, checked against
  the tree by a key cross-check (366 explicit keys: 11 no longer in the catalog, 6 retired).
  The critic saw a truncated copy of the merged list, so most of its 44 'missing' items were
  already carried; its four tree-verified findings are folded into classes F, I and J below and
  into amendment 4 of the Phase 20 doc (masterwroughtBody was retired at Phase 16, not 14).
- The commit walk: every first-parent commit on the branch that moved the resolved English
  slice (135 commits, `src/ui/i18n.resolved.generated/en.ts`) diffed against its parent for keys
  that already existed and changed value (592 keys, 209 deleted), then for each such key every
  locale slice compared before the last reword and at the tip: a locale that carried its own
  translation and is byte-identical today is STALE. 209 keys carried stale rows; 96 of them are
  punctuation-only English changes (the Phase 18 em dash pass, ruling D126) and carry no fill;
  the 113 semantic keys each went to a fact-checking judge and, where the judge said re-fill, an
  adversarial refuter (177 agents, zero errors): 54 re-fill, 6 partial, 50 keep, 3 disagreements,
  all three on renamed proper nouns whose non-Latin renderings the Phase 03 ledger records as
  deliberately KEPT (state.md 'the 87 non-Latin overlay renderings ... recorded as intentional'),
  so they stay.
- The side channels, base (origin/release/v0.42.0, a detached scratch worktree) against the tip:
  the sim DICT through `simDictProvidedKeys`, the deed chunks through `deedTranslationManifest`,
  the reliquary chunks through `reliquaryTranslationManifest`, and every overlay row whose own
  value is byte-identical to a wordy English (the passthrough class the registry counts as
  translated).
- The older rename wave: commit c55bf057c2 (2026-07-22, the release's own item-coin rename that
  the Phase 03 ledger says left '219 stale-calque item rows and 23 calque-only prose rows' for
  the release fill), audited the same way; 58 rows remain.

## The classes

### A. Registry pending (the worklist sees these)

14,290 rows over 940 distinct keys in 20 locales: main 9,263, sim 4,309, admin 718.
The worklist's blocked-by-default split: 8,476 autoFillable (sim chrome 3,826, hudChrome 3,617,
admin 718, itemUi 240, hud and abilityUi 75) and 5,814 humanRequired (entities.items 2,676,
guide.profPages 1,350, sim dialogue and lore 483, entities.quests 395, guide.professions 210,
entities.npcs 192, entities.abilities 182, the rest under 65 each). Per locale: the five
non-Latin carry 188 rows each (172 auto plus 16 human); es 848, fr_FR 893, id_ID 878, tr_TR
889, vi_VN 885, pl_PL 890, it_IT 895, pt_BR 895, sv_SE 903, de_DE 906, nl_NL 906, cs_CZ 910,
da_DK 911; es_ES and fr_CA mirror es and fr_FR and inherit; en_CA carries none.

### B. Reword-stale, packet-side (invisible to the registry; FULL replacement)

27 keys, 341 rendered rows across the 18 base overlay files (es_ES and fr_CA inherit):

| rows | key | what changed |
|---|---|---|
| 20 | guide.worldPage.valePlaceNotes | the Sowfield clause (garden beds, not the boarball ground) |
| 20 | guide.profPages.masterworkBody | a second paragraph: apex crafts are the one masterwork exception |
| 20 | guide.profPages.craftProse.cooking.materialsHeading | 'rod, knife, and furrow' |
| 20 | guide.profPages.craftProse.cooking.materialsBody | the farm supplier paragraphs and the apex feasts |
| 20 | guide.profPages.craftProse.alchemy.materialsHeading | 'Herbs, glands, glass, and the garden' |
| 20 | guide.profPages.craftProse.alchemy.materialsBody | the garden supplier paragraph |
| 20 | guide.interfacePage.mobileBody | four action buttons, the consumables row, the quick-actions route |
| 20 | guide.controls.mobileBody | the Quick Actions control replaces the corner arrow |
| 20 | entities.abilities.frenzied_regeneration.description | '(Druid talent)' dropped upstream; every overlay still carries it (state.md 4307) |
| 19 | entities.abilities.wyvern_sting.name | renamed Drakesting; every overlay still renders Wyvern Sting |
| 16 | entities.abilities.preparation.description | names Smokefade (was Smokestep) |
| 15 | guide.profPages.gatherDeeds.mining / logging / herbalism | 'any three gathering trades' (farming counts) |
| 15 | guide.professions.gatherHubBody | farming joins the gathering trades |
| 12 | entities.abilities.swiftmend.name | Fleetmend; ja_JP renders the superseded coin itself |
| 9 | guide.worldPage.nightPlaceNotes | the Moonspring (was the Moonwell) |
| 5 | guide.profPages.farm.bedsBody | the five non-Latin render a pre-11g English (phase-19g-qa.md) |
| 5 | guide.profPages.craftProse.inscription.routeBody | the apex-rung rule reversed |
| 5 | guide.profPages.craftIntro.enchanting | three trainer-taught recipes, not two |
| 5 | guide.profPages.craftIntro.cooking | 'the season's harvest' |
| 5 | guide.professions.perfectingBody | the apex masterwork paragraph |
| 5 | entities.abilities.summon_voidwalker.name | Duskmurk (zh_CN zh_TW ja_JP ru_RU cs_CZ) |
| 5 | entities.abilities.heroic_leap.name | Vaulting Charge (the five non-Latin) |
| 5 | entities.abilities.crusader_strike.name | Oathstrike (the five non-Latin) |
| 4 | guide.profPages.craftProse.jewelcrafting.routeBody | the apex-rung rule reversed (ru_RU already refreshed) |
| 1 | entities.abilities.holy_shock.name | cs_CZ 'Svatý otřes' calques the superseded Holy Shock |

Contested, the maintainer's call: guide.profPages.craftProse.cooking.routeBody (the Hearth
clause 'the feast' to 'dinner'; the 11c ledger orders a full replacement of the five non-Latin
rows, the judge and refuter both read the change as wording only).

Kept by ruling, not filled: entities.abilities.frozen_orb.name (zh 寒冰宝珠), the Frostmane
family (zh 霜鬃, ko 서리갈기) and every other row in the Phase 03 kept-renderings set.

### C. Reword-stale, release-side (inherited debt the packet's PR would also carry)

33 keys, 548 rendered rows: the v0.40.0 resurrection rewords (ancestor_return,
collective_reversal, recall_the_fallen, temporal_reversal: 40 yards, line of sight, 'at your
side'), demon_skin, reaping_command, corpse_explosion, oath_chain, multi_shot, cold_focus,
the enchanting notes (disenchantNote, salvageNote, typedNote: held off-hands), the graphics notes
(gfxEffectsNote, advancedMixes: anti-aliasing off the chain), interfacePage.barsBody (the second
swing bar), devCommand.actions.biskit.description, the twelve Crucible set bonuses (fifteen Latin
each, the v0.41.0 retune), faq.a6ThreeRods (five non-Latin), ignition.description (es_ES, fr_CA).
Not the packet's rewords; listed because the release's own fill left them and the same pass
can close them.

### D. The older rename wave's stale calques (c55bf057c2, packet-flagged at Phase 03)

20 keys, 58 rows, all item names but one, all in the Latin locales the release never
re-filled: arcane_essence (4), arcane_shard (2), arcane_dust (1), mithril_mining_pick (8),
thorium_mining_pick (7), thorium_ore (5), thorium_warblade (3), thoriumscale_leggings (1),
silverleaf_sickle (8), silverleaf_herb (1), silverleaf_healing_draught (3),
silverleaf_mana_draught (3), silverthread_slippers (1), elderwood_axe (3),
elderwood_battle_staff (1), stalkerhide_jerkin (1), sootscale_mantle (1), venomfire_elixir (2),
glimmerfin_koi (2), guide.profPages.craftIntro.tailoring (ja_JP, 'gildenweave').

Also in this class: the four renamed talent titles (Victor's Surge, Thunderhurl, Zealwing,
Spiritcall) in `src/ui/talent_i18n.ts` titleOverrides, whose 15 Latin values the Phase 03 ledger
records as closest-translations of the OLD names (state.md 945); 60 rows to re-judge.

### E. Sim DICT

aura.frostbite ('Wintergnaw', renamed at c9950d0299) is stale in the eight newest locales
(cs_CZ nl_NL pl_PL id_ID tr_TR sv_SE vi_VN da_DK), 8 rows. The ledger's log.quaff gap is
closed (every locale block carries its own row today); error.castingPlanting has no own row in
any locale and is on the worklist. The passthrough audit finds ZERO sim rows whose own value is
wordy English.

### F. Deed chunks (outside the registry; the release-tier arm 'covers every manifest row in all 18 base locale tables' in tests/deed_i18n.test.ts)

652 missing rows over 21 ids: prog_master_gatherer (desc, all 18), the farming family
(prog_first_planting, chr_vale_first_harvest, chr_marsh_first_harvest, chr_peaks_first_harvest,
chr_evergarden_first_harvest, col_golden_harvest, prog_farming_100 incl. its title,
col_farm_roster, prog_field_to_feast, prog_legendmaker, col_deepest_cast: name and desc, all 18),
the jewelcrafting and inscription trios (rare, 50, grandmaster incl. title: the 13 Latin chunks),
dgn_sanctum_speed.name and chr_nightbloom_first_cast.name (13 Latin), chr_peaks_chapter_iii.desc
(12). Plus 3 stale rows (dgn_sanctum_speed.name ja_JP zh_CN, chr_nightbloom_first_cast.name
ko_KR). Per locale: 41 missing in each Latin chunk (id_ID 40), 24 in each non-Latin.

Found by the completeness critic and verified in the chunks: the ru_RU chunk carries the whole
zone-harvest and first-cast family (Frostveil, Amberfall, Nightbloom, Wraithwood, Palmreach,
Evergarden) as ROMANIZED Russian, 11 names and 12 descs ('Urozhay na terrasakh', 'Poymay rybu
v vodakh Nightbloom.'), not the single desc the Phase 03 ledger names; the ja_JP and ko_KR
chunks render the same 12 descs each with the zone name in Latin letters inside an otherwise
translated sentence. Release-inherited rows in the same channel; the deed pass replaces the
23 romanized ru_RU rows and settles the zone-name register for the 24 ja_JP and ko_KR rows.

### G. Reliquary chunks (tests/reliquary_i18n.test.ts, the 18-locale arm)

Zero missing rows. One stale desc in all 18 locales: professions_field_notes.desc gained
'golden harvests' (D169).

### H. Register passes and special rules (live, from the ledgers)

- de_DE, pl_PL, tr_TR: hudChrome.training.alreadyKnown reconciled to the locale's player
  register (Sie, plural, formal), then re-copied byte for byte into error.patternKnown in the
  sim DICT (both tables).
- ru_RU: decide once whether guide prose keeps craft names in Latin or Cyrillic and apply it
  across every guide.profPages row (the whole-file craft-name register pass); keep 'Шедевр' for
  the masterwork seal; the masterwroughtSystem glossary note is not re-edited.
- The five non-Latin overlays: craft names and deed names inside craftProse prose aligned with
  the deed chunks and item rows (ja/ko/zh_TW print English deed names in the jewelcrafting and
  inscription route prose).
- ja_JP: alchemy.ladderBody's Latin elixir names to the item register; 'ルーンの革' to the
  enchant name key's 'ルーンの獣皮'; the farming-page fill that names the hoe in English.
- ko_KR: cooking.materialsBody's '사냥 고기' to the item's '야생 고기' (verify; a later change may
  have repaired it); farm.tableBodyOneMeal register (zh_CN zh_TW ko_KR).
- ru_RU: 'Стойкость' for Stamina to 'Выносливость' in guide prose; the enchant-note tier names
  in the Cyrillic register; the 'Perfected only' badge eyeballed at mobile width.
- zh_CN: faq.a10 stores a literal backslash-n (toolEffectsBody stores the same double-backslash
  form the English does, so only faq.a10 diverges); Highwatch in Latin in the craft prose
  against 高望 in the ladder prose of the inscription page.
- ko_KR and zh_CN: the specimen item names and 'A Perfect Specimen' in English inside
  guide.professions.harvestBodyFamilies (class J, the 11m set).
- The five non-Latin soup names' 'frost gourd' qualifier and the ru Eastbrook stem split
  (farming/state.md 598): a read, not a defect.
- Every fill that names a world entity looks the shipped entity row up first (the Drowned
  Litany lesson, state.md 13664); no phonetic rendering of a scrubbed coin
  (tests/overlay_ip_scrub.test.ts); no duplicate display name without extending
  NAME_COLLISIONS in tests/sim_i18n_name_collisions.test.ts; the BASE_NEW spread stays
  (tests/sim_i18n_base_new_passthrough.test.ts).
- guide.gear.masterwroughtBodyLegendary's fifteen Latin fills extend BOTH CAP_PROSE_BY_LOCALE and
  LEGENDARY_PROSE_BY_LOCALE in tests/masterwrought_cap.test.ts in the same change.
- itemUi.tooltip.useFeastBuff and useFeastBuffAura carry the one-at-a-time clause byte-identical
  to the locale's itemUi.tooltip.wellFed row.
- The anti-roster pin in tests/guide.test.ts ('never enumerates the Master Gatherer roster in the
  deed prose') is extended across locales at the fill (farming/state.md 595).
- Release-time wiki seed regen: `npm run wiki:seed`, pages.xml recommitted
  (tests/mediawiki_seed_freshness.test.ts).

### I. Whole-block regens

- The five non-Latin FAQ block: CLOSED at Phase 11i, not owed. The 11i QA ledger (state.md
  13611 to 13631) retired the six misaligned question rows and the four misaligned answers from
  the five non-Latin overlays and re-filled them against the current questions in that change;
  the commit walk finds no FAQ key with a stale non-Latin row today except faq.a6ThreeRods
  (release-side, class C). The Phase 17 close's 'two whole-block regens' line predates this
  record. What remains on the FAQ is a spot-check at the fill and the q5/a5 English reword
  (class K).
- The ru_RU craft-name register pass (class H, the decision first).

### J. Machine-anchored fills owed the maintainer's re-judgement

70 keys (556 fills) in the main, sim and admin channels plus the 52 rift mechanic names (260
sim rows), read at the private page 'Masterwrought Fill Re-judgement' published from this
session; the sets, their originating review notes and their shape anchors are listed there. A
re-cut re-cuts its anchor in the same change.

Added after the critic's read: the 34 apex pattern names (entities.items.pattern_<id>.name,
five non-Latin fills each, the fourth machine-anchored set the Phase 17 close counted), and
three keys the 11l and 11m rounds re-filled in ALL eighteen overlays with no gate behind the
re-fill (hudChrome.bank.depositAllTooltip, guide.professions.harvestBodyFamilies,
guide.profPages.specimenBodyFamilies: 54 rows, Latin included). In harvestBodyFamilies the
ko_KR and zh_CN rows keep the specimen item names and the deed name 'A Perfect Specimen' in
English where ja_JP and zh_TW translate them (a register split for class H).

### K. English rewords the ledgers queued onto this lane (each changes the source first, then every locale)

1. guide.profPages.farm.bedsBody: the 'by default' qualifier on the rebindable Shift+K bind
   (farming/state.md 599).
2. guide.profPages.faq.q5 and a5: the commission FAQ promises the Maker's Bond unbind without the
   Perfecting refusal (state.md 22573, D108).
3. The older crafts' routeBody closing register (three deeds incl. the rare-tier deed, 'at 50
   skill'), Phase 06 QA ruling (4) queued to this pass (state.md 2216 to 2233).
4. guide.profPages.craftProse.inscription.materialsHeading, under-enumerating by the gourd
   (phase-19g-qa.md).

### L. Release-inherited English passthrough (the registry counts these as translated)

304 ability-name rows over 35 keys in the nine Latin locales it_IT de_DE pt_BR cs_CZ nl_NL pl_PL
id_ID sv_SE da_DK carry the English name verbatim (the Maledictor and Necromancer kits:
ossuary_mark, possess_evil_eye, soulwell, soul_lance, sentence, sacrilegious_march,
ruinous_brand, elemental_trance, dark_pact, abyssal_rift and their siblings); the release-tier
copied-English guard excludes ability names, so no gate sees them. Nine of those locales also
keep 'Evil Eye', 'Needle of Fate' and 'Sentence' in English inside possess_evil_eye.description.
Not the packet's rows; listed for the decision.

### M. Retirements the fill is asked to take

`scripts/i18n_retired_keys.mjs` records that the retired reworded keys 'keep their reviewed
overlay fills until the release fill retires them': guide.gear.masterwroughtBody,
guide.profPages.craftProse.cooking.identityBody, guide.profPages.ench.enchantsNoteOffhand,
guide.profPages.farm.tableBody (Phase 16), guide.professions.endgameMaterialsBody,
guide.profPages.craftProse.engineering.materialsBody, guide.profPages.rareBody (19F),
guide.profPages.craftProse.inscription.materialsBody (19G). Retiring means deleting the English
row and every overlay row, then the regen (a key deletion cannot be parked: the resolved slices
red under tsc until regenerated). The decision: retire them in this pass or leave them for the
post-merge chore.

### N. Ledger defects the readers recorded that a future fill would trip on

237 recorded; the load-bearing ones: prog_gather_three (state.md 6591) is not a deed id, the
live deed is prog_master_gatherer; guide.controlsPage.mobileBody (14712, 14720) is
guide.controls.mobileBody; error.patternKnown is a sim key, not a main key (770, 951);
legendary.nameNotAllowed is a server key (21254); entities.items.deed_of_making.name is a main
key (21291); guide.profPages.faq.a6 and ench.enchantsNoteOffhand are gone or retired where the
Phase 10 lists still name them; the '18 translated fills' of endgameMaterialsBody were five
(24657); the Phase 08 'sixteen Latin locales' are fifteen (3031); the 11i table names
cooking.materialsBody twice (14705, 14708). Each is corrected where the fill lane needs it and
otherwise left as a dated historical record.

## The STEP 1 decisions asked of the maintainer

1. The fill itself, in words (the contract's CONFIRM THE FILL IN WORDS).
2. The humanRequired half of class A (5,814 rows: item, quest, NPC, ability and guide prose):
   filled under the same word, as every prior release fill did, or held.
3. Class J: which flagged sets stand and which are re-cut (a re-cut re-cuts its anchor).
4. The contested cooking.routeBody rows (ledger: replace; judges: wording only).
5. Class C (548 release-inherited rows) and class L (304 passthrough rows): fill here or carry.
6. Class K: which English rewords to take in this pass.
7. Class M: retire the eight reworded keys now or leave them to the post-merge chore.
8. The ru_RU craft-name register: Latin or Cyrillic.
9. Class D's four talent titles: keep the closest translations or re-cut to the new names.
