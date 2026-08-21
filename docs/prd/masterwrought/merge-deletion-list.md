# Merge deletion list (farming absorb, Phase 11d unit 5)

## What this file is

The written, rename-aware record of every name that was present on a parent of the
farming absorb merge and is deliberately absent from the merged tree, plus the names the
absorb phases authored that exist on no parent. It is the human half of the export
and symbol census; `scripts/merge_audit/symbol_census.mjs` is the machine half and reads
the first table below. The census asserts, for every exported symbol, content-table row
id, i18n catalog key, and SimEvent name present on ANY parent (ours UNION theirs UNION
the synced release tips), that the name is present in the merged tree unless a row here
says otherwise, and that every name present on NO parent is explained (the script's
`EXPLAINED_EXTRAS` constant, mirrored in the second table).

The refs (immutable; the census reads every parent with `git ls-tree` plus
`git cat-file --batch`, never a checkout):

| Ref | Commit | Role |
|---|---|---|
| base | `e56707a675013fc1a86bb19d31a0a8d79a02a197` | merge base (informational: the census compares the parent union against merged, never base; base presence drives the release-attribution annotation) |
| ours | `d5304a78c4a1add6b1ed5a0b66ddb9f8246a4d73` | pre-merge `feature/masterwrought` tip, first parent of the absorb merge `424ce89a20` |
| theirs | `8cd964d599ebbb6800fc20741690a0b9b6f17b40` | `origin/feature/farming-plan`, second parent of the absorb merge |
| release | `f50b30de296945379f8d6076ecc56cca617b8e49` | the third parent: the release/v0.40.0 tip synced at Phase 11d STEP 0 (PR #3549); later sync merges contribute their second parents automatically, and `--release` overrides the tip |
| release (2) | `35a64818251d4eeaf0ee849b9e05db57634463a4` | the FOURTH parent: the release/v0.40.0 tip synced at Phase 11d QA STEP 0 (PR #3506), merged at `5eade5c02e`. Auto-derived off the first-parent merge chain, not configured; the census reports "release parent(s) (2)" and the run needs no flag |
| prior sync tip | `65b91fa190f1b6d7935ac38774b1742c3e93bc9c` | the release tip the branch had already absorbed before the 11d sync (informational: the sync delta window is `65b91fa190..f50b30de29`) |
| merged | the working tree | HEAD of `feature/masterwrought` (read from disk; `--merged-root` points the scan at a scratch copy) |

theirs predates every release/v0.40.0 commit after base (its merge base with the release
branch IS base, the #3493 v0.39.0 merge), so a name the release branch retired between base
and ours shows up on theirs only; the merge took ours' deletion by ordinary three-way
logic. Such names still need a row here (the parent set is the union, not base), and the
census annotates every MISSING and deleted name with its per-parent file sets, a
`base:yes/no` flag, and a packet-or-release attribution so the row can be written
mechanically.

## How Phase 17 re-runs it

    node scripts/merge_audit/symbol_census.mjs

Exit code nonzero when MISSING is non-empty, when an EXTRA has no explanation, when a
parent set is under its floor, or when a row in this file is defective. Options:
`--merged-root <dir>` (scan a scratch copy), `--json <out>` (the full sets),
`--release <ref>` (override the release parent, default `f50b30de29`; every later merge
commit on the branch's first-parent chain contributes its second parent automatically),
`--sync <ref>` (add a release tip that was synced without a merge commit),
`--no-auto-sync`, `--no-base`, `--limit <n>`. A MISSING name that no release parent
carries while base does is reported in its own release-attributable sub-list (the
release retired it and a packet parent was behind); it still requires a row here.

The mutation guard (run it whenever the script or an extractor changes): copy the five
roots into a scratch directory, delete ONE known name (un-export a function, drop one
`id:` line, drop one catalog leaf, drop one emit's `type:` literal), run with
`--merged-root <scratch>`, and confirm MISSING names exactly that symbol. A census nobody
has seen fail is not a census. The 11d pre-run's four outcomes are recorded in the Phase
11d ledger (`state.md`).

## The rules for a row

- Every row names the PHASE, the RULING (a ruling id, a commit, or a ledger section),
  the OLD name, the NEW name where it is a rename, the CLASS, and the REASON. A row that
  says only "deleted" is a defect and fails the census (`parseDeletionList`).
- Class is one of `export`, `content id`, `i18n key`, `simevent union`, `simevent emit`
  (consumed by the census, matched by the bare old name) or `literal-only` (a record for
  the reader: a field, a non-exported in-place copy, an aura id template, an overlay row,
  a test literal; nothing for the census to match).
- A name that survives under the same name in a different file is NOT missing; such
  relocations are recorded as `literal-only` rows so the history of the
  extraction-beats-in-place rule is in one place.
- Remove a row only when the name comes back on purpose; the census prints
  `WARN deletion-list rows not matching a missing name` when a row goes stale.

## Deletions and renames (consumed by the census)

| Class | Old name | New name | Phase | Ruling | Reason |
|---|---|---|---|---|---|
| export | `wellfedTooltipLines` | `wellFedTooltipLines` | 11c | 11c-A4-KEYPAIR (one view, one key pair; 11c BUILT ledger "One view, one key pair, one vocabulary") | farming's `src/ui/wellfed_tooltip_view.ts` survives as the ONE well-fed tooltip view and its export was renamed to the surviving camel-case spelling; ours' same-named `wellFedTooltipLines` copy in `src/ui/elixir_tooltip_view.ts` was deleted in the same change, so the new name relocates rather than appears (by name it is on ours, not EXTRA) |
| export | `applyWellfedOnConsumeComplete` | `applyWellFedOnMealComplete` | 11c | 11b-D-2 / 11c-D-2 (one aura id, one mint; 11c BUILT ledger "Decision 2") | `src/sim/wellfed.ts` was rewritten as the one Well Fed mint (clear-then-grant at the updateRegen completion site) and the entry point renamed; the old name was exported on theirs only (11b kept the module deliberately unreferenced until 11c wired it) |
| export | `TerrainChunkPool` | `ZoneBuildPool` | release v0.40.0, before the merge | release commit 23b31303ec (perf(render): zone prepare's terrain and water fills go off-thread), carried by ours' release sync; theirs predates it | `src/render/terrain_chunk_pool.ts` was deleted on the release branch and replaced by `zone_build_pool.ts`; theirs still held the old file because its release base is the merge base; the absorb merge took ours' deletion (base:yes, ours:no, theirs:yes) |
| export | `terrainChunkPool` | `zoneBuildPool` | release v0.40.0, before the merge | release commit 23b31303ec, carried by ours' release sync; theirs predates it | same file as the row above (`src/render/terrain_chunk_pool.ts` to `zone_build_pool.ts`); the accessor renamed with the pool |
| export | `TerrainChunkResponse` | `ZoneBuildResponse` | release v0.40.0, before the merge | release commit 23b31303ec, carried by ours' release sync; theirs predates it | `src/render/terrain_chunk_worker.ts` was renamed to `zone_build_worker.ts` and its response union widened and renamed; theirs still held the old file; the absorb merge took ours' rename |
| i18n key | `itemUi.tooltip.useWellfed` | `itemUi.tooltip.wellFed` | 11c | 11c-A4-KEYPAIR (ruling 14 of the delegated block: masterwrought's pair survives; the coverage comparison was a measured tie and the tie-break went to copy) | farming's key pair retired from `src/ui/i18n.catalog/items.ts`; the surviving key keeps masterwrought's replacement-clause wording and its restore-line adjacency (11c carry 9) |
| i18n key | `itemUi.tooltip.useWellfedAura` | `itemUi.tooltip.wellFedAura` | 11c | 11c-A4-KEYPAIR | the aura-named fallback of the same retired pair; its ten non-Latin overlay rows died in the same change (overlays are outside the catalog census; see the literal-only row below) |
| i18n key | `sim.rift.detonateHellfireBrand` | (none) | 03 (QA) | masterwrought commit 8eef8bf81b (fix(naming): close the phase 03 QA blockers on the non-English surfaces) | a dead key with no emit anywhere, stripped from the catalog, the sim matcher, and 19 locale rows when the Hellfire noun was renamed to Pitfire; theirs and the release branch still carry it (base:yes, sync:yes) because the deletion is masterwrought's; the absorb merge and the 11d release sync both took ours' deletion by three-way logic |

## Explained extras (mirror of `EXPLAINED_EXTRAS` in the script; names on neither parent)

| Class | Name | Phase | Ruling | Reason |
|---|---|---|---|---|
| export | `WELL_FED_AURA_ID` | 11c | 11b-D-2 / 11c-D-2 | the one aura id seam constant (`src/sim/wellfed.ts`, value `'well_fed'`) every runtime site references; replaces the retired per-kind `wellfed_<kind>` ids |
| export | `applyWellFedOnMealComplete` | 11c | 11b-D-2 / 11c-D-2 | the renamed mint entry point (see the rename row above) |
| export | `FoodConsuming` | 11c QA | 11c QA audit should-fix (architecture): the Consuming record kind-scoped | the food arm of the `Consuming` union in `src/sim/types.ts`; `Consuming` itself survives as the alias and `isConsuming` is unchanged |
| export | `DrinkConsuming` | 11c QA | 11c QA audit should-fix (architecture) | the drink arm of the same union (a DrinkConsuming `@ts-expect-error` pin twins the def pin) |
| export | `ConsumableDefFacts` | 11c | 11c-A2-BUILDER | the builder's structural parameter type in the new `src/sim/consuming.ts` module (satisfied by `FoodItemDef` and every drink def without an ItemDef union import) |
| export | `buildConsuming` | 11c | 11c-A2-BUILDER | the one Consuming build site; both real writers (the items.ts food/drink arm and the feast bite) route through it |

Names that came in through a release sync after the merge are not extras and are not
listed here: the synced release tip is a PARENT of the census (see the refs table), so
its names are simply present on a parent.

## release/v0.40.0 sync (PR #3549), the Phase 11d STEP 0 sync window

Deletions and renames in the window `65b91fa190..f50b30de29`: NONE, verified by a
per-class set diff of the two release tips through the census extractors (2026-08-21):
exports 17212 to 17221 with 0 deleted, content ids 2810 to 2810, i18n keys 17861 to
17866 with 0 deleted, SimEvent union 152 to 152, SimEvent emits 142 to 142. There is
nothing to record under this heading; a later sync that DOES delete or rename a name
adds its rows here with the reason read from the release diff
(`git diff <prior tip> <new tip> -- <file>`), never a bare "deleted".

What the window added (informational, all present on the release parent): the reliquary
HUD tracker family, 9 exports (`installTrackerStackAnchor`, `TrackerStackAnchor`,
`TrackerStackAnchorDeps`, `TrackerStackAnchorMeasure`, `InstalledTrackerStackAnchor`,
`trackerStackAnchorTopPx`, `TRACKER_STACK_ANCHOR_GAP_PX`, `ReliquaryTrackerWorld`,
`makeReliquaryTrackerInput`) and 5 i18n keys (`options.showReliquaryTracker`,
`reliquary.trackerToggleLabel`, `reliquary.trackerToggleShowHint`,
`reliquary.trackerToggleHideHint`, `settingsPage.ifShowReliquaryTracker`).

## release/v0.40.0 sync (PR #3506), the Phase 11d QA STEP 0 sync window

Second sync window, `f50b30de29..35a6481825`, merged at `5eade5c02e`. Deletions and
renames: NONE, verified the same way (2026-08-21): the window touches no file under
`src/sim/`, `server/`, `src/sim/content/` or `src/ui/i18n.catalog/`, so content ids,
i18n keys and both SimEvent classes are unchanged, and exports go 17221 to 17234 with
0 deleted. There is nothing to record under this heading either.

What the window added (informational, all present on the newer release parent): the
stale-focus Space fix, 13 exports across three new modules
(`src/game/stale_chrome_focus.ts`: `FocusedChromeEl`, `isStaleChromeButton`;
`src/ui/chrome_focus_wiring.ts`: `CHROME_GUARDED_PANELS`, `CHROME_TRACKER_BLURS`,
`wireChromeFocus`; `src/ui/pointer_blur.ts`: `ClickLike`, `BlurrableEl`,
`POINTER_FOCUS_PARK_SELECTOR`, `dropPointerFocus`, `blurIfPointerClick`,
`ListenerHost`, `bindPointerBlur`, `bindChromeButtonKeyGuard`). No i18n key, no
content id, no SimEvent.

The census picked `35a6481825` up automatically as a second release parent, off the
first-parent merge chain, with no flag: the refs table's promise that later syncs
contribute their second parents is now exercised rather than only stated.

## Literal-only records (not symbols in any census class; kept for the reader)

| Class | Old name | New name | Phase | Ruling | Reason |
|---|---|---|---|---|---|
| literal-only | `BaseItemDef.wellfed` (theirs' lowercase field, `src/sim/types.ts`) | `FoodItemDef.wellFed` | 11c | 11b-D-2 / 11c-D-2; 11b carry item 8 | a field, not an export: farming's lowercase twin of masterwrought's `wellFed` was deleted and its runtime `consumed.kind !== 'food'` guard made unrepresentable under the kind-scoped union (pinned by a self-verifying `@ts-expect-error`); verified: theirs' types.ts line `wellfed?: { aura: string; kind: AuraKind; value: number; duration: number }`, merged has `wellFed?: TimedStatBuffPayload` only |
| literal-only | `consumed.kind !== 'food'` runtime guard (theirs' `src/sim/wellfed.ts`) | (types beat guards) | 11c | 11b-D-2 / 11c-D-2 | the guard went with the field; the claim is now true at the def AND the record (`FoodConsuming` / `DrinkConsuming`) |
| literal-only | `wellfed_<kind>` aura ids (theirs' `src/sim/wellfed.ts` minted `` `wellfed_${w.kind}` ``; only `wellfed_buff_sta` ever rendered; `src/sim/content/profession_items.ts` payloads spelled `aura: 'Well Fed', kind: 'buff_sta'` and never the id) | `'well_fed'` via `WELL_FED_AURA_ID` | 11c | 11b-D-2 / 11c-D-2 | a template literal with a substitution, so never a census content id; the retired-namespace sweep in `tests/wellfed.test.ts` pins that no quoted `wellfed_` prefix survives in src/, scripts/, tests/; the un-re-recorded `farming_session` golden keeps six `wellfed_buff_sta` aura rows until 11d's re-record (11c composition record) |
| literal-only | `wellFedTooltipLines` copy in ours' `src/ui/elixir_tooltip_view.ts` | the same name in `src/ui/wellfed_tooltip_view.ts` | 11c | 11c-A4-KEYPAIR; 11c BUILT ledger "One view" | masterwrought's copy of the well-fed tooltip lines (exported from the elixir view on ours) was deleted; the NAME survives in farming's view, so by name it relocated; `elixirTooltipLines` stays in place; `ELIXIR_STAT_KEYS` stays a private byte-identical twin of `WELLFED_STAT_KEYS` by the rule of three (recorded in the file) |
| literal-only | `WELLFED_STAT_KEYS` re-export from theirs' `src/ui/wellfed_tooltip_view.ts` | the definition in `src/ui/wellfed_stat_keys.ts` (unchanged) | 11c | 11c review round (frontend note: the now-importerless re-export was dropped) | a re-export line, not a definition; the name is present on merged in its defining leaf |
| literal-only | the ten non-Latin overlay rows of `itemUi.tooltip.useWellfed` / `useWellfedAura` (`src/ui/i18n.locales/{ja_JP,ko_KR,ru_RU,zh_CN,zh_TW}.ts`) | the surviving pair's rows | 11c | 11c-A4-KEYPAIR | overlays are not the catalog and are outside the census roots' i18n class; recorded so the fill has the history |
| literal-only | the `prog_master_gatherer` deed `desc` rows in all 18 `src/ui/deed_i18n.locales/*.ts` (the old text named the four gathering trades; the deed's `name` rows survive) | (none: the count-free English desc renders as the fallback until the release fill re-fills the locales) | 11b (farming's pre-merge change, taken by the absorb merge) | 11b QA audit record, "Release-fill obligation added by this audit" (state.md); standing at the 11c ledger | deed locale rows are values inside `deed_i18n.locales`, outside every census class (the catalog census reads `src/ui/i18n.catalog/` only); farming rewrote the English desc count-free and deleted the stale translated rows, so the orphan is owned by the release fill; recorded so the fill has the history |
| literal-only | `castDisplayName` in-place arrow in ours' `src/ui/hud.ts` (`const castDisplayName = (id: string): string =>`, not exported; ours had added exactly the one `SUNDER_CAST_ID` arm) | `castDisplayName` exported from farming's `src/ui/cast_display_name.ts` (the SUNDER arm ported between SALVAGE and TOOL_RECHARGE) | 11b | 11b RULE 2, extraction beats in place (11b BUILT ledger "The three rules as applied") | same-name relocation from a non-exported in-place copy to an exported module; hud.ts imports it; `targetCastDisplayLabel` rides the same module |
| literal-only | `entityDisplayName` in ours' `src/ui/entity_display_core.ts` (byte-equivalent to base) | `entityDisplayName` in farming's `src/ui/entity_display_name.ts` (base plus the live feast-title arm plus its own Vitest) | 11b | 11b RULE 2 (a NEW member of the extraction class: both packets had extracted it from hud.ts into different modules) | one authority survives; the core's copy was REMOVED with a pointer comment; the name is present on merged, so by name it is a relocation, not a deletion; `tests/entity_display_core.test.ts` follows the authority move |
| literal-only | the six ability tooltip functions in ours' `src/ui/hud.ts` (`describeAbilitySummary`, `resourceDisplayName`, `abilityRangeLine`, `playerSpellHasteFrac`, `abilityCastLine` in place, `abilityRequirementLines` exported) | the same six names exported from farming's `src/ui/ability_tooltip_lines.ts` | 11b | 11b RULE 2 ("all six ability_tooltip_lines functions ... UNCHANGED by ours, extraction wins clean") | same-name relocation; only `abilityRequirementLines` was an export on ours, and it is present on merged in the new module |
| literal-only | the turnstile trio in ours' `src/main.ts` (`ensureTurnstile`, `turnstileToken`, `resetTurnstile`, in place, plus the private `turnstileApi` helper) | `ensureTurnstile`, `turnstileToken`, `resetTurnstile`, `TURNSTILE_SITEKEY` exported from farming's `src/game/turnstile_gate.ts` | 11b | 11b RULE 2 / RULE 3 (main.ts unioned the turnstile block) | same-name relocation; `turnstileApi` was a private helper absorbed into the module; main.ts imports the trio |
| literal-only | `HEAVY_SELF_CMDS` and `HEAVY_SELF_EVENTS` in ours' `server/game.ts` (module-private `const` sets, not exported) | the same names exported from farming's `server/heavy_self.ts` | 11b | 11b RULE 2 ("HEAVY_SELF_*, and every other swept symbol: UNCHANGED by ours, extraction wins clean"); security review: membership set-compared across both parents and the merge (58/55, nothing lost) | same-name relocation; game.ts imports both; `HEAVY_SELF_REFRESH_TICKS` stays a game.ts local on both sides |
| literal-only | `tests/release_v039_icon_art.test.ts`: the TWO farming literals (the art-subject count and the pending hotbar count) | the re-derived literals, executed 2026-08-21: art-subject `toHaveLength(72)` to 75, `hotbarItems` 72/72 to 75/75 | 11b park / 11d unit 3 | 11b-PARK-1 and 11d-U3-ICON (settled 2026-08-20, executed at unit 3) | nothing was deleted: the ASSERTION was generalized into farming's art-subject split and both literals re-derived on the merged tree (the three phase 10 role foods join the subject set); there is NO deletion-list row for the assertion itself, and tests/ is not a census root, so this row is a record only |
