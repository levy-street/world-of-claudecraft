# Phase 11d: Derived artifacts, pins, and the merge audit

### Starter Prompt
```
This is Phase 11d of the Masterwrought feature: re-derive every artifact the farming
absorb invalidated, and prove the resolution is correct rather than merely green.

THE THESIS, and it governs every step below. The merge destroys its own ability to
detect a bad resolution, and that is structural, not a worry. 22 files were hand
resolved across 5306 conflict lines in 11b and 11c (src/ui/hud.ts alone carries about
250, which no research lane read whole). Every artifact that would normally catch a
regression is now re-minted FROM THE MERGED TREE: 67 parity goldens, 27 generated
files, 13 count pins, the frozen deed catalog SHA, the art census digests, the four
eastbrook source-byte seals. Each of them agrees, after the fact, with whatever the
resolution produced. A dropped hunk, a lost content row, a union import that took one
side instead of both, or a payload that silently stops being carried all produce a
green gate. The live proof already exists: consumeFeastAction built p.eating with no
wellFed field, so adopting the carried-payload design killed the feast buff and failed
no test on either branch. That is one instance found by hand in one file.
A green gate on this merge proves the tree is self-consistent, not that it is correct.
Everything below that looks like bookkeeping IS the evidence, and the two pieces that
supply the missing proof are the export and symbol census (unit 5) and the golden
composition check (unit 2).

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed; the work is mechanical,
scripted, and strictly ordered. The judgment was spent in 11b and 11c.

Goal: every re-minted artifact provably correct rather than merely green. Seven work
units, seven separately reviewable commits, in a fixed order: REGEN, GOLDENS, ART
CENSUS, COUNT PINS, the EXPORT AND SYMBOL CENSUS, the MONOLITH CEILINGS, and the
DECISIONS-INDEX ROWS. No semantic resolution happens here; if this phase needs a design
decision, it belongs to 11b or 11c and the phase stops.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- ENTRY GATE, hard: 11b and 11c are committed, npx tsc --noEmit is clean, and no
  SEMANTIC file is still open. Running a generator before 11c is final means running
  it twice and losing the classification baseline. If tsc is red, STOP: this phase
  does not resolve semantics.
- DECISION 4 (monolith ceiling policy) IS SETTLED 2026-08-20 (the full delegation) and is
  recorded in the dated delegated-rulings block at the end of
  docs/prd/masterwrought/state.md. EXECUTE it: four recorded raises at the exact merged
  line counts, each with a ledger row naming this merge, both parent pins, and the reason,
  with src/ui/hud.ts paid back by extraction in Phase 14. Copy the ruling into this phase's
  state.md ledger row as answered; do not ask for it and do not re-open it. Unit 6 proceeds
  on it. WHY: mixing about 431 lines of behavior-bearing extraction into a 160-file merge
  makes the diff unreviewable, and the ratchet's credibility comes from the raise being
  recorded and paid back, not from never rising. REJECTED: funding that extraction inside
  this phase.
- DECISION 2 IS READ, NOT RE-OPENED: the well-fed ladder, the single aura id, and the
  retired tooltip key pair were settled in 11c. This phase carries their consequences
  into pending.ts, the goldens, and the deletion list. If a number here disagrees with
  11c, 11c is right and the artifact is wrong.
- ENVIRONMENT GATE: DATABASE_URL must be OUT of the environment for this entire phase.
  Do not source .env around any vitest or gate run. Print `env | grep -c DATABASE_URL`
  and require 0 before the goldens commit. Named trap: a dev DATABASE_URL poisons seven
  characterization goldens with dev-db data.
- SYNC RELEASE: git fetch origin, merge the newest origin/release/** into
  feature/masterwrought, run the release-merge-audit skill on the merge. Do this BEFORE
  the first prediction is derived. Every literal this phase predicts from is read off
  three fixed refs, and a release absorb landing mid-phase invalidates all of the
  predictions at once. If a release merge lands after predictions are written, re-derive
  every one of them from scratch. Never patch a prediction.
- Memory scan: the test-pin trap index (READ it before any pin work), the count-pin
  composition trap, "gate env: DATABASE_URL poisons goldens", "release-merge gate
  surprises" (shard-weight union below 95 percent reds the gate), "pin source must
  carry identity", "portrait seal vs comment-only src edits", "mutation harness must
  prove tests ran", "test-pin constant-self-comparison".

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md: the three-tier ordering rule from 11b, the 11b and
  11c ledgers, and every deletion or rename those two phases recorded.
- docs/prd/masterwrought/progress.md: the 11b and 11c rows.
- docs/prd/masterwrought/farming/state.md: farming's D-numbered decisions and deviation
  letters, since several merged pin comments cite them.
- The merge classification (160 conflicted paths): REGEN 27, GOLDEN 67, ART_CENSUS 17,
  COUNT_PIN 13, TAIL_APPEND 14, SEMANTIC 22.
- Files: tests/monolith_budget.test.ts, tests/world_api_parity.test.ts,
  tests/command_schema.test.ts, tests/deeds_content.test.ts, tests/deed_i18n.test.ts,
  tests/deeds_view.test.ts, tests/deed_icons.test.ts, tests/reliquary_content.test.ts,
  tests/profile_page.test.ts, tests/professions_blob_growth.test.ts,
  tests/professions_blob_roundtrip.test.ts, tests/material_taxonomy.test.ts,
  tests/material_taxonomy_bootstrap.test.ts, tests/recipe_economy.test.ts,
  tests/sfx_manifest.test.ts, scripts/item_art_audit.mjs,
  tests/item_art_audit_builder.test.ts, tests/item_art_consistency.test.ts,
  tests/parity/scenarios.ts, scripts/ci_shard_weights.generated.json,
  scripts/build_sfx_manifest.mjs, scripts/wiki/build_content.mjs, docs/qa-gate.md.
- The three refs, read with `git show <ref>:<path>` only. This phase NEVER runs a
  mutating git command against another ref: no checkout, no restore, no stash.
  base   = e56707a675013fc1a86bb19d31a0a8d79a02a197 (the merge base)
  ours   = the pre-merge feature/masterwrought tip recorded in the 11b ledger
  theirs = origin/feature/farming-plan
Return: for each pin file, the base, ours, and theirs literals verbatim, and the exact
assertion line each one lives on. Return the literals, not a summary of them.

STEP 2 - EXECUTE.

ORDER IS THE DESIGN. The seven units run in the order below and each commit lands before
the next unit starts. Everything above the count pins moves numbers, which is why the
pins come last, and every generator run before the semantics are final is a run that
has to happen twice.

ONE STATED EXCEPTION, which is a run-order note and not a reordering: the census script
of unit 5 is AUTHORED AND RUN read-only BEFORE unit 1 begins. It needs no re-minted
artifact, it runs in seconds, and finding a dropped hunk after 67 goldens have been
re-recorded means re-recording them. It still lands as its own commit in position 5,
with its final green run recorded there.

PARALLEL FAN-OUT, honestly bounded. The re-mint spine is single threaded by the
ordering rule. Three lanes are genuinely independent and run in parallel at the head of
the phase:
Agent 1 (census engineer): unit 5's script and deletion list, plus its read-only
  pre-run. Depends on nothing but the merged tree.
Agent 2 (prediction desk): reads the three literals for every pin in units 4 and 6 and
  writes the predictions into the state.md ledger BEFORE any suite is run. Read-only,
  git show only.
Agent 3 (art census sweep): unit 3's audit-builder run and the four eastbrook seal
  re-sweep. Independent of the generators and the goldens; commits in position 3.
The spine (units 1, 2, 4, 6) stays serial in the main loop, and unit 7 is doc-only and
rides its tail.

UNIT 1 - REGEN (27 files). Commit 1.
- Never hand-resolve a generated artifact. Take either side to unblock (they are machine
  output), then run the owning generator. A PreToolUse hook already blocks direct edits
  to the *.generated.ts and resolved-i18n artifact classes; needing to edit one by hand
  is the signal that the wrong step is running.
- The 27: the 24 files under src/ui/i18n.resolved.generated/ (cs_CZ, da_DK, de_DE, en,
  en_CA, en_XA, es, es_ES, fr_CA, fr_FR, id_ID, it_IT, ja_JP, ko_KR, nl_NL, pending.ts,
  pl_PL, pt_BR, ru_RU, sv_SE, tr_TR, vi_VN, zh_CN, zh_TW), plus
  src/ui/i18n.catalog/translation_keys.generated.ts, src/guide/content.generated.ts,
  and scripts/ci_shard_weights.generated.json.
- Run, in this order:
  npm run i18n:gen      (i18n:build + i18n:admin + i18n:scan; rebuilds all 24 bundles,
                         pending.ts, and translation_keys.generated.ts)
  npm run wiki:content  (rebuilds src/guide/content.generated.ts)
  npm run sfx:manifest  (node scripts/build_sfx_manifest.mjs)
- WHY sfx:manifest is on this list, since it was missing from every research lane's
  recipe: farming ships five mp3s plus src/game/sfx_manifest.generated.ts and
  public/audio/sfx/runtime-pack.json, and the full gate has a dedicated SFX conformance
  step. Verified on the three refs: tests/sfx_manifest.test.ts pins keys.size at 265 on
  base, 265 on ours, 270 on theirs, and NO sfx file appears in the 160 conflicted paths.
  So the manifest, the runtime pack, and the pin all merge textually clean from farming
  into a tree that never re-derived them. Predicted merged keys.size is 265 + 0 + 5 =
  270, and the regen must produce a ZERO diff against the merged committed manifest. A
  non-zero diff here is not a stale artifact to accept, it is evidence that the merged
  cue set is not what either parent shipped.
- scripts/ci_shard_weights.generated.json, SETTLED 2026-08-20: a CI harvest keyed by test
  file path with a __provenance block (run, harvested, files). Resolve as a KEY UNION of the
  two maps, take the NEWER __provenance block, and re-derive `files` from the merged key
  count. HAND-WRITTEN WEIGHTS ARE REFUSED, in every branch of this decision. Measure the
  union's coverage before committing, and if it lands under 95 percent, a FRESH CI HARVEST
  RUN happens BEFORE this phase closes, never after and never as a follow-up. WHY: the
  release-merge ledger names the sub-95-percent union as one of three ways a non-trivial
  merge reds the gate for non-code reasons, and invented weights make the LPT balancer
  distribute against fiction, which is worse than an unbalanced but honest table.
  gate-integrity-reviewer is a REQUIRED dispatch on this file, not an optional one.
- i18n scope: PR tier permits English-only. The one exception is M16, a new wordy
  English value needs its non-Latin fills in the same change. Do not fill a pending row
  here; the release-tier pass is a Phase 17 line item. 11c retired one of the two
  competing tooltip key pairs, so pending.ts moves in that direction and that movement
  is expected.
- Proof: run every generator a SECOND time and require a zero diff (idempotence is the
  freshness gate), then
  npx vitest run tests/i18n_resolved_equivalence.test.ts tests/guide.test.ts
  tests/sfx_manifest.test.ts tests/localization_fixes.test.ts

UNIT 2 - GOLDENS (67 files). Commit 2, and it contains NOTHING but goldens.
- Preconditions: unit 1 green, tsc clean, `env | grep -c DATABASE_URL` prints 0.
- Resolve all 67 conflicts by taking either side purely to unblock; the content is about
  to be overwritten. Then re-record in one isolated commit:
  UPDATE_PARITY=1 npx vitest run tests/parity
- WHY no golden may be hand-merged or side-picked: all 67 shared goldens moved on BOTH
  sides, for two independent reasons. Farming shifts entity-id allocation by exactly +4
  at world init (tick-0 nextId 968 to 972 in tests/parity/golden/solo_warrior.json), and
  masterwrought's serialized state gained craftDaily and wyrmfallDaily. The merged
  digests therefore differ from both parents everywhere. Picking a side is wrong for all
  67 and hand-merging one is impossible.
- THE COMPOSITION CHECK, scripted, never an eyeball. Land it as
  scripts/merge_audit/golden_composition.mjs. For each of the 67, extract the readable
  non-digest fields (ticks, draws, coverage, nextId, entityId, sourceId, id) from base,
  ours, theirs, and merged, and assert mergedDelta == oursDelta + theirsDelta on every
  one of those fields. Any golden whose readable fields do not compose is a finding to
  investigate BEFORE the commit lands.
- Two anchors, both already known:
  1. Merged tick-0 nextId in solo_warrior.json must read 972.
  2. draws and drawDigest must be UNCHANGED from ours in any scenario neither packet
     touched, because farming shifted ids without perturbing the rng stream. A moved
     draws count in an untouched scenario is a DETERMINISM REGRESSION, not a re-record:
     stop and investigate, do not commit it.
- The two clean adds: tests/parity/golden/rift_clear_rewards.json (ours) and
  farming_session.json (theirs). tests/parity/scenarios.ts is modified by farming but
  does not conflict, so both scenario appends merge automatically. Verify in BOTH
  directions by count: every golden file has a scenario row, every scenario row has a
  golden file, and each new scenario lands in a parity shard (parity_a through parity_g).

UNIT 3 - ART CENSUS and the four eastbrook seals (17 files). Commit 3.
- Run the audit builder (scripts/item_art_audit.mjs) to mint catalogSha256, catalogBytes,
  rendererFingerprint, and the counts. Paste the reported values into
  tests/item_art_audit_builder.test.ts and tests/item_art_consistency.test.ts; the four
  docs/achievements JSONs are the swept manifests and follow the same mint.
- Predicted-then-observed applies here too. Base carries catalogCount 823 and
  liveItemCount 838 with NO pendingArtCount field; farming introduced that field with
  its 44 literal. So predict catalogCount 907 and liveItemCount 922 (base plus
  masterwrought's 84 item ids) with pendingArtCount 44, keep farming's structural split,
  and treat any deviation as a finding to explain before the paste rather than a number
  to accept.
- The four eastbrook JSONs (docs/screenshots/eastbrook-vale-rebuild/polish/metadata/
  after-desktop-ultra.json and after-mobile-low.json, plus polish/performance/
  after-desktop-ultra-town.json and after-mobile-low-town.json) and their two suites
  (tests/eastbrook_polish_artifact_integrity.test.ts,
  tests/eastbrook_polish_capture_contract.test.ts) are SEAL manifests, not art
  manifests: their digests are swept over SOURCE bytes. No browser capture is taken.
  Re-sweep only, and record the re-mint in the house form:
  "Re-minted for the farming absorb: renderer.ts and prewarm_policy.ts moved, the seals
  follow the swept evidence bytes. No capture was retaken."
- tests/release_v039_icon_art.test.ts, SETTLED 2026-08-20, and the answer is neither of the
  two the conflict suggested. Farming did not delete the assertion and did not move it: it
  REFACTORED it into the ART-SUBJECT SPLIT (artSubjectHotbarItemIds, live minus
  ITEM_ART_PENDING, plus a new pendingHotbarItemIds literal, plus a both-directions debt
  check), read directly from
  `git show origin/feature/farming-plan:tests/release_v039_icon_art.test.ts` at lines 394 to
  447 against the branch copy's single liveHotbarItemIds .toHaveLength(75). EXECUTE: take
  farming's refactored form and RE-DERIVE both literals on the merged tree, art-subject to
  75 (masterwrought's three painted phase-10 role foods on top of farming's 72) and pending
  to the merged count, which is 16 here and grows as 11e through 11k park ids. Add this file
  to docs/prd/masterwrought/merge-deletion-list.md ONLY for the two farming literals it
  replaces, NEVER for the assertion, and note in the list that nothing was deleted from this
  file: an assertion was generalized and both literals re-derived. WHY: farming's form is
  strictly more general (it polices the debt in both directions, so a stale pending entry
  that has since shipped art also fails) and it is the rule scripts/item_art_audit.mjs
  already applies; writing "deleted" for a refactor would corrupt the one artifact Phase 17
  re-runs as a delivery gate. REJECTED: masterwrought's single-literal form, and any
  deletion-list row for the assertion itself.
- Memory anchors: "pin source must carry identity" (walk the data path; a stripping
  projection silently weakens any fingerprint) and the portrait-seal note (v0.38 and
  later tolerate bundle-only drift; re-bless only on real drift).
- Proof: the suites green on a SECOND run without further edits.

UNIT 4 - COUNT PINS (12 of the 13; tests/monolith_budget.test.ts is unit 6). Commit 4.
- THE METHOD IS THE DELIVERABLE, not the numbers. For every pin: read the three literals
  with git show, compute base + oursDelta + theirsDelta, WRITE THE PREDICTION INTO THE
  STATE.MD LEDGER, then run the suite and REQUIRE the observed value to equal the
  prediction. A mismatch is a real defect (a dropped row, a double count), not a pin to
  bump. Pasting an observed value without a prediction is exactly how a lost row goes
  green: the composition trap has already fired four times on tests/command_schema.test.ts
  alone (extract_essence with deed_set_border, then tabPrev, lock_item, market).
- The worked predictions below are values to CHECK AGAINST. They are never values to
  paste. If the run disagrees with one of them, the run is the evidence and the
  disagreement is the finding.
  tests/world_api_parity.test.ts: 332 total, 88 data, 244 method. Derivation: base
    323/86/237, plus masterwrought's extractEssence (1 method), plus farming's eight
    (farmPatches and myFarmPlots as data; plantCrop, harvestCrop, convertHusks,
    farmNowMs, placeFeast, consumeFeast as methods). Internal check: 88 + 244 = 332. The
    union-before-dedup and union-after-dedup assertions are both 332 and they are the
    duplicate guard: if a merged facet declares a member twice they disagree.
  tests/command_schema.test.ts: no literal is quoted here on purpose. Derive BOTH counts
    from the three refs. Farming adds the server/farming_commands.ts set plus the feast
    place and consume pair; masterwrought added its own. Predict both, then run.
  tests/deeds_content.test.ts: DEED_ORDER.length 286 (273 + 6 + 7); total renown 3270
    (3155 + 80 + 35); category progression 65 (57 + 6 + 2); titles 45 (42 + 2 + 1);
    borders 4 (unchanged). Farming's other categories moved too and did NOT conflict
    only because masterwrought did not touch them: four chr_*_first_harvest chronicle
    rows and one col_golden_harvest collection row. Verify them anyway.
  tests/deed_i18n.test.ts: manifest length 617 (286 * 2 + 45); title rows 45.
  tests/deeds_view.test.ts: visible count is 286 minus 4 feats minus the merged hidden
    set, and the hidden set must be READ from src/sim/content/deeds.ts, never assumed,
    because col_golden_harvest's hidden and luck classification is farming-owned. The
    ours-side arithmetic was 279 - 4 - 9 = 266.
  tests/deed_icons.test.ts (classified ART_CENSUS but it carries deed counts):
    DEED_IMAGE_IDS.size 278 (271 + 6 + 1); DEED_ART_PENDING 8 (2 + 0 + 6). Re-check it
    here, after the deed counts land.
  tests/reliquary_content.test.ts: overview total 345 (340 + 4 + 1); character completion
    316 (311 + 4 + 1); slot count 380 (375 + 4 + 1); distinct mark ids 31 (29 + 2 + 0);
    horizons_titles 43 (40 + 2 + 1). These base figures were derived by SUBTRACTION from
    the two branch literals rather than read: read them directly with git show before
    trusting them, and if a base literal disagrees, the prediction is rebuilt from the
    read value.
  tests/profile_page.test.ts: catalogTotal 316, which tracks reliquary character
    completion (311 + 4 + 1).
  tests/professions_blob_growth.test.ts and tests/professions_blob_roundtrip.test.ts:
    re-derive the bound on the MERGED serialized shape, which now carries farming's
    farmPlots alongside masterwrought's craftDaily and wyrmfallDaily. Farming measured
    the blob first-hand: empty character 1499 B compressed and 2059 B raw; 23 beds
    planted 3261 and 7831; about 251 B raw per plot; TOAST past 2 KB; WAL plus 1.5 to
    3 KB per 30 s autosave. Predict from the two parents' bounds plus that measured
    per-plot cost, then run. This phase owns the PIN; Phase 12 owns the merged size
    BOUND as policy.
  tests/material_taxonomy.test.ts and tests/material_taxonomy_bootstrap.test.ts: READ AND
    CLASSIFIED 2026-08-20, so the classification is settled and only the values are derived.
    tests/material_taxonomy_bootstrap.test.ts IS a count pin: line 26 asserts
    `expect(MATERIAL_ITEM_IDS.size).toBe(66)`, so it takes the full predicted-then-observed
    treatment like every other pin here. tests/material_taxonomy.test.ts is NOT a count pin:
    it is exact-set equality against a HONEST_MATERIALS literal plus membership and
    class-exclusion arms with ZERO count literals, so it resolves on its own terms by
    re-deriving the sorted literal from the merged tree. Record BOTH classifications in the
    ledger and CORRECT the 13-file COUNT_PIN class count to whatever the corrected
    membership gives. WHY, and it reaches far past this phase: MATERIAL_ITEM_IDS is DERIVED
    by deriveMaterialItemIds from every recipe and enchant reagent filtered to kind 'junk',
    so 11l and 11m both move it by adding reagents, and the exact-set literal and the size
    66 both move with them. REJECTED: resolving either file as a generic count pin.
  tests/recipe_economy.test.ts: two SORTED literal pins, both edited by both packets.
    Recompute BOTH from the merged ALL_RECIPES. Never hand-merge a sorted literal list.
  FROZEN_CATALOG_SHA256: not arithmetic, and it matches NEITHER parent (ours
    ea007571..., theirs 3bc5bc55...). Re-mint it LAST, only after every count above is
    green, and record the re-baseline in the house form: "no shipped trigger or renown
    changed; the merged hash is re-minted from the suite output".
  DEED_ORDER[len-1]: decided by the 11b three-tier ordering rule, not derived. Under
    that rule it is 'prog_farming_100' until 11e appends.
- The 14th pin, which is not in the conflict list and is the same trap as
  src/sim/content/items.ts: tests/sfx_manifest.test.ts keys.size, predicted 270. A pin
  that merges clean into a tree whose truth changed underneath it is the most dangerous
  kind, because nothing draws attention to it.
- FORWARD CARRY, re-owned 2026-08-20 so the named phase re-derives rather than
  re-discovers. 11e appends ONE cosmetic collection deed for growing the whole crop roster
  at renown 5, which moves DEED_ORDER to 287 and total renown to 3275 with deed_i18n and
  DEED_IMAGE_IDS following, and moves DEED_ORDER's tail pin off 'prog_farming_100'. 11i
  appends one deed at renown 10 for the apex rod craft, and 11k appends prog_field_to_feast;
  neither is 11e's. The recipe_seasoned_stock bill belongs to 11g, not 11e, and it takes
  marsh_rice 2 PLUS bog_beet 2, so BOTH tests/recipe_economy.test.ts literals move by two
  rows rather than one: the 98-to-114 figure recorded here was computed for marsh_rice alone
  and is now a FLOOR, never the answer, and 11g re-derives the real input value against its
  output of 30 to show the gold-negative pin still holds. Every phase named here re-derives
  its own numbers by this same predicted-then-observed method.

UNIT 5 - THE EXPORT AND SYMBOL CENSUS. Commit 5. THIS IS THE PHASE'S MOST IMPORTANT
DELIVERABLE and the only mitigation for the merge's top risk. If one thing in this whole
program is skipped, it must not be this.
- Land it as scripts/merge_audit/symbol_census.mjs plus a written deletion list at
  docs/prd/masterwrought/merge-deletion-list.md, so Phase 17 can re-run it as a delivery
  gate.
- What it asserts: for every exported symbol, content-table row id, i18n key, and
  SimEvent name present on EITHER parent, that name is present in the merged tree unless
  it is on the written deletion list. The parent set is ours UNION theirs, not base: a
  symbol both parents deleted is legitimately gone.
- Four extractors, each mechanical and each needing no judgment:
  1. Exported symbols: every `export const|function|class|interface|type|enum|let` name
     plus every name in an `export { ... }` list, across src/, server/, headless/, bot/,
     and scripts/.
  2. Content-table row ids: the id literals in src/sim/content/*.ts (items, recipes,
     deeds, reliquary pages, mobs, quests, zones, patterns, professions).
  3. i18n keys: the leaf key paths in src/ui/i18n.catalog/*.ts.
  4. SimEvent names: the event kind literals in the SimEvent union and at every emit
     site.
- Two reported assertions:
  MISSING = (ours union theirs) minus merged minus deletionList. Must be EMPTY. Any
    member is a dropped hunk or a lost row.
  EXTRA = merged minus (ours union theirs). Must be exactly the set the 11b and 11c
    ledgers authored (for example the WELL_FED_AURA_ID export and the wellFedTooltipLines
    rename). An unexplained extra is a duplicate definition or a stale copy, which is
    precisely what the extraction-versus-in-place class produces with ZERO conflict
    markers.
- The deletion list is rename-aware. Every entry names the phase, the ruling, the old
  name, the new name where it is a rename, and the reason. Seed it from the 11b and 11c
  ledgers. Known members at authoring time:
  - farming's BaseItemDef.wellfed field and its runtime consumed.kind !== 'food' guard
    (11c: unrepresentable under the kind-scoped union)
  - farming's wellfed_<kind> aura ids (11c: one aura id 'well_fed')
  - masterwrought's copy of the well-fed tooltip lines inside src/ui/elixir_tooltip_view.ts
    (11c: farming's view survives)
  - the wellFedTooltipLines export rename in src/ui/wellfed_tooltip_view.ts (11c)
  - whichever of the two tooltip key pairs 11c retired
    (itemUi.tooltip.wellFed / wellFedAura versus itemUi.tooltip.useWellfed /
    useWellfedAura), after the locale-fill coverage comparison
  - the in-place copies deleted by 11b's extraction-beats-in-place rule, castDisplayName
    in src/ui/hud.ts and every other member of 11b's enumerated set
  - tests/release_v039_icon_art.test.ts's TWO farming literals only (the art-subject and
    pending hotbar counts, re-derived in unit 3), with the row saying plainly that the
    ASSERTION was not deleted: it was generalized into the art-subject split and both
    literals re-derived. Settled 2026-08-20; there is no deletion-list row for the
    assertion itself.
- PROVE THE CENSUS RAN AND WOULD FAIL. Two guards, both required:
  1. Mutation: delete one known symbol from the merged tree in a scratch copy and
     confirm the census reports it. A check nobody has seen fail is not a check.
  2. Floors: pin a minimum size on each parent symbol set, so an extractor that silently
     matches nothing cannot pass by comparing two empty sets.
- The parents are read with git show. No checkout, no worktree switch, no stash.
- If a CI job is ever meant to run this script, check the sparse-checkout cone rows in
  .github/workflows and the union pinned by tests/ci_workflow.test.ts before assuming
  scripts/merge_audit/ is visible to that job.

UNIT 6 - MONOLITH CEILINGS, under decision 4 as SETTLED 2026-08-20. Commit 6, alone,
because it carries signed raises and deserves its own reviewable diff. The decision is
answered, so this unit proceeds without a gate: four recorded raises at the exact merged
line counts, each with a ledger row naming this merge, both parent pins, and the reason.
Record the DIRECTION honestly, because that is what makes the ledger a measurement rather
than an excuse: hud.ts and renderer.ts RISE against masterwrought's pins while sim.ts (12650
to 12340) and main.ts (11516 to about 11479) FALL. A ratchet that only ever shows raises has
stopped being read.
- Verified literals on masterwrought's tip (tests/monolith_budget.test.ts): hud.ts 19445,
  renderer.ts 13546, sim.ts 12650, main.ts 11516. Farming's pins: hud.ts 19186 (file
  19183), renderer.ts 13774, sim.ts 12232, main.ts 11460.
- PROVENANCE OF THE FOUR FIGURES BELOW, so no later session "corrects" them back. They
  come from a plain `git merge --no-commit --no-ff` of origin/feature/farming-plan, then
  counting the conflicted src/ui/hud.ts: 19489 total lines, 15 marker lines (5 hunks times
  3), 19235 clean, 150 ours-side, 89 theirs-side. That decomposition sums exactly to 19489
  and is the file a resolver actually opens. A `git merge-file --diff3` measurement of the
  same merge reports different components (19233 / 152 / 91), because diff3 emits a fourth
  marker and a base section per hunk; those numbers are internally consistent only within
  diff3 accounting and must never be mixed with the plain-merge set. Use the plain-merge
  set. If a figure here is ever disputed, re-run the plain merge and re-count rather than
  trusting either record.
- Measured on the real trees for src/ui/hud.ts: a clean common region of 19235 lines, a
  take-theirs floor of 19324, a take-ours value of 19385, and a union of 19474, against
  masterwrought's zero-slack pin of 19445 and farming's pin of 19186. THERE IS NO
  RESOLUTION OF hud.ts AT OR UNDER FARMING'S PIN, because masterwrought added roughly 141
  lines outside every conflict region, which puts even the take-theirs floor 141 above
  farming's own file. The realistic 11c resolution lands near 19460.
- THE PIN IS THE EXACT LINE COUNT OF THE RESOLVED FILE, measured with wc -l after 11c,
  never one of those four estimates and never a parent's number. A ceiling above the file
  is slack the ratchet exists to remove.
- The other three, measured merged: sim.ts 12340, renderer.ts 13576, main.ts about 11479.
- Direction, stated exactly so the ledger is honest: against the LOWER parent pin all
  four are raises. Against masterwrought's own pin, hud.ts and renderer.ts rise (roughly
  15 and exactly 30) while sim.ts and main.ts FALL (12650 to 12340, 11516 to about
  11479), which tightens those two rows. Set each row to the exact merged count in both
  directions.
- Each raise gets a ledger comment in the file's existing house form, naming THIS merge,
  BOTH parent pins, and the reason: a two-packet union where neither side's extractions
  cover the other side's additions. This is the same move both branches already made at
  every release absorb (farming did it on renderer.ts at plus 30 under deviation (an);
  masterwrought did it on hud.ts with its 19445 row), so it is consistent precedent
  rather than a new exception. It is four raises in one commit, settled 2026-08-20 under the
  full delegation, so the raises are authorized and the reviewable artifact is the ledger row
  on each of them.
- COMPLETENESS: re-derive EVERY row in MONOLITHS against the merged tree, not just the
  four. The merge moved at least three more monolith files: server/game.ts (both parents
  edited it), src/net/online.ts (both grew it), and server/db.ts (farming grew it). A row
  that still has slack keeps its pin. A row whose merged file now exceeds its pin is
  SETTLED 2026-08-20 as a RECORDED RAISE on the same terms as the four, TAKEN INSIDE THIS
  PHASE, never a return to a STEP 0 gate and never a silent bump. The authorization is
  SCOPED and the scope is the whole point: it covers only growth attributable to the MERGE
  (both parents' content landing in one file) and does NOT cover growth a phase AUTHORED.
  Every additional row is listed explicitly in the ledger with both parent pins and a NAMED
  payback phase. No extraction runs inside this phase. WHY: the merge is ONE event, and
  splitting its ceiling record across two decisions makes the ledger lie about the cause;
  server/game.ts, src/net/online.ts and server/db.ts are in the identical situation as the
  four named files. REJECTED: a silent raise, and an unscoped blank cheque covering
  phase-authored growth.
- The payback is scheduled, not deferred, and its target is SETTLED 2026-08-20: hud.ts is
  paid back by extraction in Phase 14, which already owns HUD work and where both packets
  left thin-consumer wiring behind. Record it as a Phase 14 CARRY naming BOTH numbers, the
  merged count it must come down FROM and masterwrought's 19445 as the minimum it must reach.
  Phase 14's acceptance does not pass until tests/monolith_budget.test.ts's hud.ts row reads
  19445 or lower AND the ceiling is LOWERED in the same change. State the one exclusion in
  the carry: the professions-module migration into src/ui/hud/professions/ does NOT count
  toward this target, because a file move relocates ZERO lines out of hud.ts and would
  otherwise be miscounted as payback. WHY: a raise with no payback number is a permanent
  raise, and naming the number is what lets the Phase 14 session know when it is done.
  REJECTED: recording the payback as "extraction in Phase 14" with no target.
- Recorded for the record, since it was the rejected option: honoring the strict "only
  ever lower" reading against the lower parent pin costs about 431 lines of new
  extraction across the four files (hud about 274, sim 108, renderer 30, main about 19).
  Funding that inside a 160-file merge phase is how a merge phase becomes three merge
  phases.

UNIT 7 - THE DECISIONS-INDEX ROWS. Commit 7, doc-only, assigned to this phase on
2026-08-20 because it is already the doc-truing phase and it runs before every phase that
would cite an R-number in source. BOTH rows were AUTHORED AHEAD OF THIS PHASE by the
2026-08-20 reconcile pass (NEW WORK N1 and N2 are discharged), so this unit is now a
VERIFICATION against the MERGED tree, with authoring as the fallback if the merge lost
either row. Verify both, in one commit, opening the file ONCE:
- THE R-NAMESPACE ROW, which the collision makes load-bearing. Shipped source already cites
  a DIFFERENT R series (Professions 2.0) at R1, R4, R8, R9, R14, R19, R22, R30, R35, R37 and
  R39 to R50; shipped R19 is the fishing teaching ceiling and shipped R22 is the wield gate.
  Packet numbers are NEVER renumbered, so the rule is written instead: any R-number written
  into src/, server/, tests/, a CLAUDE.md, or docs/design/ by phases 11b through 11o reads
  "masterwrought R<n>" IN FULL, and a bare R-number in those files means the Professions 2.0
  series, permanently. docs/design/ is in scope because docs/design/professions.md is that
  series' OWN authority file and Phase 11j writes masterwrought R17 to R20 into it. The row
  must carry the reviewer instruction too: a bare packet R-number in source is a FINDING, not
  a nit. WHY: decisions-index.md already documents the collision and
  only the namespace row is missing, and leaving it unowned is what would let 11m edit
  src/sim/content/professions.ts (which cites shipped "R22/R50") against an index that never
  got its row.
- THE ADMISSION ROW CORRECTION, already applied by the reconcile pass and widened by the
  quality-review adoption pass: the NNb / NNc
  namespace row now reads 11b through 11o, FOURTEEN inserted phases, all ADMITTED, citing
  ip-GATE-PAIN, 11m-ADMIT and qr-11o-ADMIT (state.md row 117). VERIFY that on the merged
  tree and restore it if the merge
  reverted it. WHY: a session that loads decisions-index.md first would otherwise conclude
  three phases are optional under a delivery contract that has no deferral state.
This unit moves no artifact, no pin and no ceiling, so it lands after unit 6 and reds
nothing.

INVARIANTS IN PLAY: no semantic resolution happens in this phase; no generated artifact
is hand-edited; no golden is hand-merged or side-picked; no pin is pasted without a
written prediction that predates it; DATABASE_URL stays out of the environment; every
parent tree is read with git show and never checked out; the 11b three-tier ordering rule
governs every append-only table and is not re-opened here.

Out of scope: any 11b or 11c resolution (if one is needed, this phase stops); the seed
faucet and the farming apex arm (11e); the release-tier i18n fill (Phase 17); the hud.ts
extraction payback (Phase 14).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit
npx vitest run tests/i18n_resolved_equivalence.test.ts tests/guide.test.ts
  tests/sfx_manifest.test.ts tests/localization_fixes.test.ts
npx vitest run tests/parity   (full, WITHOUT UPDATE_PARITY)
node scripts/merge_audit/golden_composition.mjs   (all 67 compose)
npx vitest run tests/item_art_audit_builder.test.ts tests/item_art_consistency.test.ts
  tests/missing_painted_icons_wave.test.ts tests/release_art_audit_v036_reliquary_deeds.test.ts
  tests/release_v039_icon_art.test.ts tests/deed_icons.test.ts
  tests/eastbrook_polish_artifact_integrity.test.ts tests/eastbrook_polish_capture_contract.test.ts
npx vitest run tests/world_api_parity.test.ts tests/command_schema.test.ts
  tests/monolith_budget.test.ts tests/deeds_content.test.ts tests/deed_i18n.test.ts
  tests/deeds_view.test.ts tests/reliquary_content.test.ts tests/profile_page.test.ts
  tests/professions_blob_growth.test.ts tests/professions_blob_roundtrip.test.ts
  tests/material_taxonomy.test.ts tests/material_taxonomy_bootstrap.test.ts
  tests/recipe_economy.test.ts
node scripts/merge_audit/symbol_census.mjs   (MISSING empty, EXTRA explained)
npm run ci:changed
node scripts/gate_select.mjs, then npm run gate as the deeper check. This is the first
point in the program where the merged tree can plausibly pass a full gate, and it is the
right place to pay for one. The gate needs a COMMITTED tree, and a gate run is never
piped through tail (that masks the exit code).
Review Dispatch Matrix rows: cross-platform-sync (the parity pin and the wire command
counts moved), architecture-reviewer (the goldens are the sim's determinism evidence and
the draws anchor is a determinism claim), database-performance-reviewer (the blob-growth
pins are stored-data growth), migration-safety (the merged characters.state shape now
carries both writers), gate-integrity-reviewer (the shard-weight table is the gate and CI
selection pipeline), plus qa-checklist at the end. SKIPPED with a reason:
frontend-seam-reviewer (no frontend surface moves, only re-minted artifacts) and
privacy-security-review (no server, net, admin, or secret surface changes; dispatch it if
either new script reads anything outside the repo). COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (seven commits, in this order, explicit paths, bodies, no session
trailers). The order is part of the deliverable: a reviewer must be able to read the
goldens commit alone.
- chore(build): regenerate i18n, wiki, and sfx artifacts on the merged tree
- test(parity): re-record the 67 merged goldens with the composition check
- test(art): re-mint the item art census and the eastbrook source-byte seals
- test(pins): re-derive the merged count pins, predicted then observed
- test(merge): add the export and symbol census and its deletion list
- test(pins): record the merged monolith ceilings with their ledger rows
- docs(masterwrought): the R-namespace and admission rows in the decisions index

STEP 5 - ACCEPTANCE:
- [ ] Every generator is idempotent: a second run produces a zero diff
- [ ] sfx manifest, runtime pack, and keys.size 270 all agree, with a zero-diff regen
- [ ] Shard-weight union coverage is at or above 95 percent, provenance is the newer
      block, files re-derived, no weight hand-written; if it landed under 95 percent, a
      fresh CI harvest RAN before this phase closed
- [ ] The goldens commit contains nothing but tests/parity/golden/*.json
- [ ] All 67 goldens compose: mergedDelta == oursDelta + theirsDelta on every readable
      field; merged tick-0 nextId reads 972; draws unchanged in every untouched scenario
- [ ] Both new goldens registered in tests/parity/scenarios.ts and assigned to a shard,
      verified by count in both directions
- [ ] Art census observed values match the prediction (907 / 922 / 44) or the deviation
      is explained in the ledger; the four eastbrook seals re-swept with the house
      re-mint line and no capture retaken
- [ ] tests/release_v039_icon_art.test.ts carries farming's art-subject split with BOTH
      literals re-derived (art-subject 75, pending the merged count), and the deletion list
      says plainly that no assertion was deleted from it
- [ ] Both material-taxonomy files classified in the ledger (bootstrap IS a count pin at
      MATERIAL_ITEM_IDS.size; material_taxonomy is exact-set equality and is NOT), and the
      COUNT_PIN class count corrected
- [ ] Every count pin has a written prediction that PREDATES its observation, and
      predicted equals observed for every one of them
- [ ] FROZEN_CATALOG_SHA256 re-minted LAST, after the counts are green
- [ ] The census reports MISSING empty; every deletion is on the written list with a
      phase, a ruling, and a reason; every EXTRA is explained
- [ ] The census mutation guard fires and the parent-set floors are pinned
- [ ] Decision 4 recorded as SETTLED (2026-08-20) in the ledger, with no gate in this file
      left reading confirm-at-STEP-0; every monolith row re-derived against the merged tree;
      each of the four is the exact wc -l with zero slack; the direction of each is recorded
      honestly, raises and falls alike
- [ ] Any FIFTH or further monolith over its pin is taken here as a recorded raise, scoped
      to merge-attributable growth, with both parent pins and a NAMED payback phase, and no
      extraction ran inside this phase
- [ ] The hud.ts payback is a Phase 14 carry naming BOTH numbers (the merged count it comes
      down from and 19445 as the minimum), with the professions-module migration excluded
      from the target
- [ ] decisions-index.md carries the masterwrought R-namespace row (bare R-numbers in
      src/, server/, tests/, a CLAUDE.md or docs/design/ mean Professions 2.0; packet numbers
      read "masterwrought R<n>" in full) and the corrected admission row (11l, 11m, 11n,
      11o ADMITTED; fourteen inserted phases), both VERIFIED against the merged tree
- [ ] tsc clean, ci:changed clean, gate_select green

STEP 6 - DOCS: progress.md 11d row; state.md ledger carrying the predicted-versus-observed
table for every pin side by side, the four ceiling rows with both parent pins and the
reason, the art census values, the golden composition result, the census result with its
deletion list pointer, the DATABASE_URL note, decision 4 as settled 2026-08-20 with the
direction of each row, any additional monolith raise with its scope and named payback, and
the two decisions-index rows unit 7 wrote;
farming/state.md gains an open-item row for anything the census or a pin turned up that
this phase did not settle; memory note for anything that surprised you.

STEP 7 - REPORT: phase status, the seven commits, validation results, reviewer verdicts,
and a handoff line for Phase 11d QA naming every pin 11e will move again.

STOPPING RULES: decision 4 is SETTLED (2026-08-20) and is never a stop, and a fifth
monolith over its pin is no longer a stop either, because unit 6 is authorized to record it
with a scope and a named payback. Stop and ask if tsc is red or any 11c SEMANTIC file is
still open at STEP 0; if the state.md delegated-rulings block disagrees with this file; if a
predicted pin does not equal
its observed value and the difference cannot be explained by a named row (that is a lost
or duplicated row, and the fix lives in 11b or 11c, not in the pin); if the golden
composition check fails on any of the 67, or draws moves in a scenario neither packet
touched; if the census reports a MISSING member that is not on the written deletion list;
if a generator is not idempotent on a second run; or if any step would require hand
editing a generated artifact.
```
