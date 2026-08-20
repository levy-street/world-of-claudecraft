# Phase 11b: The farming absorb

### Starter Prompt
```
This is Phase 11b of the Masterwrought feature: the farming absorb. The maintainer has
pulled the completed farming packet (the fifth gathering profession, branch
origin/feature/farming-plan, 14 phases done) INTO this packet, so both ship as one
branch and one PR. This phase is the merge itself and NOTHING else: one tree that
compiles, the farming docs re-homed, and zero design change.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (four parallel resolution slices over
160 conflicted paths, then one serial doc-move slice).

Goal: a true merge commit of origin/feature/farming-plan into feature/masterwrought,
every conflicted path resolved under a written mechanical rule, the ItemDef union port
done, docs/farming/ re-homed under docs/prd/masterwrought/farming/, ending with
npx tsc --noEmit clean and tests/architecture.test.ts green, and every remaining red
NAMED and LISTED with its owning phase.

Live surface: none. This phase ships no new player-reachable behavior, no new content
row, no new mechanic. It makes two shipped systems coexist in one tree.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):

0a. THE FOUR DECISIONS, SETTLED 2026-08-20 (the full delegation). Decisions 1 through 4
are ANSWERED. They live in the dated delegated-rulings block at the END of
docs/prd/masterwrought/state.md ("Decisions closed 2026-08-20 (the full delegation)").
COPY them into the state.md Phase 11b ledger as answered before the merge runs; do not ask
for a confirmation and do not re-open one. 11b executes the merge and moves no number.
- Decision 1, GATE 1 / D11, the tier 3 and 4 seed bootstrap: FIXED. Vendor-stock every
  tier 3 and tier 4 seed at farmer_hollis and farmer_verbena on the D11 tier 1/2 pattern,
  executed ONCE, in Phase 11e, at the prices 11e derives. After 11e's crop roster lands
  that is EIGHT rows, not four: the four shipped seeds plus the four new crops' seeds.
  11b's own obligation is the negative half: no resolver here, and no session in 11f, 11g,
  11h or 11k, may treat reagent dormancy as settled, and every downstream phase proves the
  faucet by READING the merged vendorItems arrays in code, never a ledger row.
  WHY: R18 needs a profession through its OUTPUT, and a reagent with no faucet is not an
  output, so every tier 3 and 4 bill would ship dormant on a packet whose delivery contract
  has no deferred state.
  REJECTED: leaving the faucet to a later pass.
- Decision 2, the well-fed unification and the power ladder: SETTLED, all six axes as
  drafted. One aura id 'well_fed'; masterwrought's FoodItemDef.wellFed carrying
  TimedStatBuffPayload (kind-scoped, so a drink cannot spell it); masterwrought's
  clear-then-grant mint order; farming's src/sim/wellfed.ts module and its tooltip view;
  the ladder re-tuned to farming 2/3/4/5 at 600s with the three apex role foods at 6/900.
  Phase 11c executes it. 11b parks toward that target and changes NO number.
  WHY: as merged the ladder INVERTS. Farming's cooking-50 trainer dish
  evergarden_braised_greens pays buff_sta 12 for 900s while the cooking-100 drop-taught
  stonepot_stew pays 6 for 600s, and a trainer dish beating a raid plate on both axes
  breaks R5 before Phase 15 can measure anything.
  REJECTED: cutting farming's four wellFed payloads (deletes a shipped, QA'd deliverable);
  lifting the apex to 8 or above (breaks the flask 15 plus food 6 equals 21 stamina kit
  R5 was measured against).
- Decision 3, the delivery-contract amendment: ADOPTED as drafted, BOTH halves. Farming is
  absorbed; D22 and its addendum (B) are superseded IN PLACE with a dated banner and never
  deleted; D22's absorb discipline (newest-release re-resolution by version sort, the
  sync-mid-phase rule, --no-ff phase merges, one teardown decision over both trees) is
  adopted upstream. AND an "accepted-by-design" handoff row already constitutes an explicit
  record and satisfies the delivery contract's CUT requirement. 11b writes the amendment text.
  WHY: decisions-index.md's never-renumber rule requires supersession in place, and a dated
  row saying "accepted, here is why" is the most explicit form a record takes, which is all
  the contract asks.
  REJECTED: re-closing the 44 accepted-by-design rows at Phase 17 (it nearly doubles the
  closing matrix to produce a second copy of an existing record).
- Decision 4, monolith ceiling policy for the four coordinators: FOUR RECORDED RAISES at the
  exact merged line counts, taken in Phase 11d, each with a ledger row naming this merge,
  both parent pins, and the reason; src/ui/hud.ts paid back by extraction in Phase 14. 11b
  touches no ceiling. There is NO resolution of hud.ts at or under farming's pin of 19186:
  the take-theirs floor is 19324 and the realistic resolution about 19460, because
  masterwrought added roughly 141 lines outside every conflict region.
  WHY: funding 431 lines of behavior-bearing extraction inside a 160-file merge commit is
  exactly the diff shape that makes a merge unreviewable, and the ratchet's credibility
  comes from the raise being recorded and paid back, not from never rising.
  REJECTED: funding that extraction inside the merge phase.

0b. git status clean; then SYNC RELEASE: git fetch origin --prune, resolve the NEWEST
origin/release/** by version sort (git branch -r --list 'origin/release/*' | sort -V,
take the last row), merge it into feature/masterwrought, run the release-merge-audit
skill on that merge. Do this BEFORE the farming merge, never after: a release sync run
on top of a half-resolved two-packet union is unauditable. Note the consequence out
loud: the sync moves the merge base, so the conflict counts below are a PREDICTION, not
a promise.

0c. BASELINE CAPTURE (cheap here, expensive later). Before merging, record into a
scratch file, for every COUNT_PIN file and every monolith ceiling, the THREE literals:
base (git merge-base HEAD origin/feature/farming-plan), ours (HEAD), theirs
(origin/feature/farming-plan). Phase 11d predicts base + oursDelta + theirsDelta from
exactly these numbers and requires observed to equal predicted; capture them while the
merge base is still trivially reachable. Also record the farming tip hash you actually
merge (it was 8cd964d599 at planning time; re-resolve it, never assume it).

0d. Memory scan: the test-pin trap index (READ it, do not skim), the release-merge gate
surprises note, the "gate needs a COMMITTED tree" and shared-stash notes, the
shared-worktree commit-care note (explicit paths, never git add -A), the parallel
subagent cluster in the gotcha index (agents EDIT the real worktree, so slices must be
file-disjoint), and the pin-source-must-carry-identity note.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (Delivery contract; R1-R23, R17 to R20 being the
  gathering half's rulings; the Phase 11 ledger and
  its OPEN maintainer decisions block) and progress.md (the status table and its Notes
  tail; the stale "11 QA | pending" row that this phase corrects).
- docs/prd/masterwrought/phase-11c-food-and-feast.md, phase-11d-derived-artifacts.md,
  phase-11e-mastery-curve.md: read what each OWNS, so nothing lands here that belongs
  there.
- The farming packet as it stands on origin/feature/farming-plan: docs/farming/README.md,
  implementation-plan.md, state.md (D1-D24, the D22 addendum, the MAINTAINER GATES
  block, the 117-row handoff table head), progress.md tail.
- The merge surface itself: src/sim/types.ts (the ten-member ItemDef union at :1355,
  OtherItemDef at :1224, FoodItemDef at :1245 and its doc comment), src/sim/combat/auras.ts
  updateRegen, src/sim/items.ts use-arm chain, src/ui/hud.ts (READ IT WHOLE; it carries
  about 250 of the 5306 conflict lines and no research lane read it end to end),
  tests/monolith_budget.test.ts, tests/ci_workflow.test.ts, tests/farming_asset_manifest.test.ts.
Return: the ItemDef union's member-to-kind mapping; which hud.ts regions are extraction
sites versus in-place edits; the exact shape of the append-only tables' tail regions.

STEP 2 - EXECUTE.

2.0 THE MERGE (serial, alone, before any fan-out):
  git merge --no-ff origin/feature/farming-plan
A TRUE MERGE COMMIT. Never --squash, never a rebase, never cherry-picks. Farming's 397
commits must stay reachable so the release-merge convention keeps working and every
"merged at <hash>" line in the farming ledgers stays resolvable. After the merge halts,
list the conflicts and CLASSIFY every path into exactly one of six classes before
resolving anything:
  REGEN 27, GOLDEN 67, ART_CENSUS 17, COUNT_PIN 13, TAIL_APPEND 14, SEMANTIC 22.
Total 160 conflicted paths; 442 of farming's 602 changed files land clean. That is the
PREDICTION from the trial merge at the merge base e56707a675013fc1a86bb19d31a0a8d79a02a197.
If your count differs, the 0b release sync explains most deltas: classify EVERY delta
before resolving, and stop if one cannot be explained.
The 60 conflicted paths carrying readable hunks are all 160 minus the 67 goldens, the 24
resolved-i18n bundles, and the 9 JSON manifests (four docs/achievements, four
docs/screenshots/eastbrook-vale-rebuild, and scripts/ci_shard_weights.generated.json).

THE THREE MECHANICAL RULES, applied everywhere, no exceptions invented mid-file:

RULE 1, THE THREE-TIER ORDERING RULE for every append-only table. Release rows first,
always, so the eventual release merge stays a pure tail append. Masterwrought's already
committed rows next, positions FROZEN: never re-sorted to sit beside their families,
never interleaved with farming's. Farming's block LAST, appended whole and contiguous,
because farming is frozen at 14 phases and masterwrought still appends through Phase 17.
Apply it to: src/sim/content/deeds.ts, recipes.ts, profession_items.ts, reliquary.ts,
src/ui/i18n.catalog/items.ts, src/ui/i18n.catalog/hud_chrome.ts, and the
tests/architecture.test.ts allowlist. Any list the file itself keeps SORTED stays sorted
(the architecture allowlist is one); the tier rule governs append-only tables only.
Two consequences are EXPECTED, RE-DERIVED, and never chosen: DEED_ORDER[len-1] becomes
'prog_farming_100' until 11e appends, and the merged FROZEN_CATALOG_SHA256 matches
NEITHER parent. Do not "fix" either here.

RULE 2, EXTRACTION BEATS IN-PLACE EDIT. Where farming deleted a block from a coordinator
because it EXTRACTED it to a new module, and masterwrought edited that same block in
place, the DELETE wins and masterwrought's edit is ported into the extracted module. A
naive keep-both mints a duplicate definition. The confirmed live case: farming moved
castDisplayName out of src/ui/hud.ts into src/ui/cast_display_name.ts, while
masterwrought added `if (id === SUNDER_CAST_ID) return t('abilityUi.cast.sundering');`
to it in place. The port is that ONE arm plus the SUNDER_CAST_ID import, inserted
between the SALVAGE and TOOL_RECHARGE arms so ours' resolver order survives; everything
else in ours' body already exists in the extracted module. hud.ts hunks 4 and 5 are the
same class against ./ability_tooltip_lines (abilityRangeLine, playerSpellHasteFrac,
abilityCastLine, abilityRequirementLines, describeAbilitySummary, resourceDisplayName)
and ./entity_display_name (entityDisplayName, which gained a feast-title arm there).
THE DANGEROUS HALF: every other member of this class arrives as a CLEAN ADD with ZERO
conflict markers, so git will never point at it. ENUMERATE THEN DIFF, before resolving:
  git diff --name-only --diff-filter=A <merge-base> origin/feature/farming-plan
and for every added module that looks like a moved block, diff its body against the
function of the same name in its old home. tsc catches a duplicate definition; it does
NOT catch a silently stale copy that still compiles. The at-risk set from the plan,
with the ten that do not exist on masterwrought today (verified) and the two that do:
  absent here, arriving as clean adds: src/sim/mob/boss_mechanics.ts, server/heavy_self.ts,
  server/character_blob_size.ts, src/render/glb_instanced_props.ts,
  src/ui/window_open_state.ts, src/ui/report_window.ts, src/ui/entity_display_name.ts,
  src/ui/cast_display_name.ts, src/ui/ability_tooltip_lines.ts, src/game/turnstile_gate.ts
  (also src/ui/gather_rare_event_feedback.ts and src/sim/wellfed.ts)
  already present here: src/sim/item_lock.ts (farming's shared countRawInSlots export),
  src/sim/mech_chroma_ownership.ts
Treat the list as a starting set, not the answer: derive the real one from the
diff-filter=A output and diff every candidate.

RULE 3, KEEP BOTH UNLESS THEY CONTRADICT. Three sub-rules, in order:
  3a. Import blocks are ALWAYS a union. The one exception is a symbol whose only
      consumer moved into an extracted module (hud.ts hunk 1 drops tSim on the theirs
      side). Union first, then grep the file for a remaining consumer, and only then
      let biome prune it.
  3b. Independent additions are kept BOTH, ours first. This covers src/sim/types.ts's
      cast-id predicate (all three of SUNDER_CAST_ID, TOOL_RECHARGE_CAST_ID and
      FARMING_CAST_ID survive), src/sim/items.ts's use-arm chain (the placeMobileStation
      arm keys on def.use?.type and the feast arm on def.feast, so they are mutually
      exclusive per item and order is behaviorally free), hud.ts hunk 3 (ours'
      recipePatternTooltipLines block, then theirs' wellfedTooltipLines and
      feastTooltipLines), the five locale overlays wherever the two key families are
      disjoint, and the two tooltip-coverage suites, whose rules COMPOSE (ours narrowed
      to def-quality; theirs added the sanctioned junk-kind exception for growth_tonic,
      deviation (ak)). Composing is the resolution; choosing is a defect.
  3c. Mutually exclusive hunks take OURS VERBATIM, delete nothing of theirs from the
      tree, and record theirs' text WHOLE on the 11c carry list in the state.md Phase
      11b ledger. The live cases: src/sim/combat/auras.ts (ours' inline clear-then-grant
      well_fed mint versus theirs' applyWellfedOnConsumeComplete call, same site,
      exclusive), src/ui/sim_i18n.ts's 'aura.wellFed' DICT value (ours 精神饱满 /
      精神飽滿 / 잘 먹음 versus theirs 饱足 / 飽足 / 포만감), the same-key
      itemUi.tooltip.useElixir and useElixirAura overlay values, and the professions
      overview prose in src/ui/i18n.catalog/guide.ts plus its five overlays (ours says
      four gathering and ten crafting, theirs says eight crafting with no gathering
      count; the MERGED TRUTH is five gathering and ten crafting, and neither side says
      it). SETTLED 2026-08-20: take OURS here and record the merged sentence as OWED TO
      11c, which WRITES it: "five gathering trades ... and a ring of ten crafts", with the
      same edit moving the second paragraph's "all four gathering professions" to five,
      around guide.profPages, plus its five non-Latin overlays. WHY: 11c already opens
      guide.ts for the Laden Hearth vocabulary reword, so it already owns a guide.ts plus
      five-overlay reword obligation in that same release-tier fill batch, and only the
      count word moves. Phase 16's arm is then VERIFY (no shipped string says four
      gathering), never author. REJECTED: leaving it to whichever phase lands first.
  Consequence to state and accept: after 3c, src/sim/wellfed.ts lands as a clean add and
  is DELIBERATELY unreferenced at the end of this phase, and auras.ts's auto-merged
  import of applyWellfedOnConsumeComplete is pruned. Both are on the carry list and 11c
  wires them. The export stays present in the tree, so 11d's symbol census still sees it.

PARALLEL FAN-OUT, four slices, file-disjoint by construction (agents edit the real
worktree, so overlap is corruption, not a merge):

Agent 1 (content tables and the ordering rule):
- src/main.ts (one import-block conflict: ours dropped worldEntryGpuSettleCoverMs,
  theirs added the turnstile_gate block; union both).
- src/sim/content/deeds.ts, recipes.ts, profession_items.ts, reliquary.ts under RULE 1.
- src/ui/i18n.catalog/items.ts, hud_chrome.ts under RULE 1.
- tests/architecture.test.ts (the pure-module allowlist; keep the file's existing sort).
- Farming's 13 rows in profession_items.ts include four kind 'food' dishes carrying
  `wellfed` (eastbrook_glazed_carrots 3/600, fenbridge_rice_pudding 6/900,
  highwatch_barley_porridge 9/900, evergarden_braised_greens 12/900) and harvest_feast,
  kind 'junk', carrying `feast: { charges: 10, durationTicks: 3600, dishItemId:
  'evergarden_braised_greens' }`. Copy them EXACTLY. Not one magnitude, duration, price,
  or charge count moves in this phase; 11c owns the ladder and 11e owns the apex arm.

Agent 2 (the ItemDef discriminated-union port):
- src/sim/types.ts. Keep ours' `elixir?: TimedStatBuffPayload` (the wider type; farming's
  inline literal shape is structurally assignable to it, verify rather than assume).
  Farming authored `wellfed?` and `feast?` on BaseItemDef, which masterwrought's union
  makes wrong in two different ways:
    `feast?` goes on OtherItemDef, the ONLY union member admitting kind 'junk'. It cannot
    go on BaseItemDef: FoodItemDef's own doc comment says the kind-scoping exists so a
    drink, a potion, or a sword cannot silently carry a payload nothing would grant, and
    a harvest_feast literal carrying `feast` hits excess-property checking against
    ItemDef otherwise.
    `wellfed?` goes on FoodItemDef, alongside ours' `wellFed?`, both present, no design
    change. All four farming dishes are kind 'food', so this type-checks. 11c retires
    `wellfed?` and its runtime `consumed.kind !== 'food'` guard; 11b keeps both spellings
    so no shipped behavior moves here.
- src/sim/content/items.ts. THIS FILE DOES NOT CONFLICT AT ALL, which is exactly what
  makes it dangerous: farming's rows merge textually clean into a tree whose item type
  changed shape underneath them. READ every incoming row and check it against the union
  member its `kind` selects. The plan records 30 rows; a direct count of the incoming
  diff returns 31 added top-level rows (27 of kind 'junk': seeds, produce, fine twins,
  withered_husks, compost, growth_tonic; 4 of kind 'tool': garden_hoe, bronze_hoe,
  skysilver_hoe, osmium_hoe), all of which land on OtherItemDef. SETTLED 2026-08-20: DERIVE
  both counts and trust NEITHER literal. Count the merged tree, split by the `kind` the row
  selects ('junk' produce and seeds versus 'tool' hoes), and record the found numbers in the
  11b report AND the state.md ledger. If a count disagrees with a plan literal, the report
  SAYS SO explicitly rather than adopting either number silently. WHY: a row vanishing
  between two counts is this merge's characteristic failure, and a number nobody re-derived
  is the predicted-then-observed pin trap. REJECTED: adopting 30 or 31 as given.
- src/sim/items.ts (RULE 3b) and src/sim/combat/auras.ts (RULE 3c).

Agent 3 (the UI and render semantic set plus the extraction sweep):
- src/ui/hud.ts, all five hunks, under RULES 2 and 3. Read the file whole first.
- src/ui/bags_view.ts (theirs adds the feast's own clickSetOut hint above the generic use
  hint; keep both arms, feast first, because the feast is placed and never eaten),
  src/ui/char_window.ts, src/ui/material_hint_view.ts, src/ui/sim_i18n.ts,
  src/render/nameplate_view.ts, src/guide/pages/professions_craft.ts,
  src/ui/i18n.catalog/guide.ts, scripts/wiki/build_content.mjs.
- The five human overlays src/ui/i18n.locales/{ja_JP,ko_KR,ru_RU,zh_CN,zh_TW}.ts. These
  are maintainer-owned files: this phase UNIONS them and changes no value except under
  RULE 3c. Keep BOTH tooltip key families intact (ours' itemUi.tooltip.wellFed /
  wellFedAura and theirs' useWellfed / useWellfedAura), because 11c retires one pair only
  AFTER comparing locale-fill coverage, and destroying a family here destroys the
  evidence that comparison needs.
- The RULE 2 enumerate-then-diff sweep over the whole diff-filter=A set.

Agent 4 (tests, and parking the four derived classes):
- Resolve as unions: tests/helpers/bare_client.ts, tests/parity/coverage_c.test.ts,
  tests/snapshots.test.ts, tests/guide.test.ts, tests/bag_filter.test.ts,
  tests/bags_view.test.ts, tests/crafted_item_tooltip_coverage.test.ts,
  tests/item_instance_tooltip.test.ts, tests/material_hint_view.test.ts,
  tests/professions_crafting.test.ts, tests/nearby_interaction.test.ts. The last one
  encodes a real ordering decision, and it is SETTLED 2026-08-20: when a farm bed and a
  mobile crafting station are both in range, THE PLACED STATION WINS, and the farm bed sits
  immediately below it in the priority order. Keep both sides' cases and PIN BOTH DIRECTIONS
  in tests/nearby_interaction.test.ts (station beside bed presses the station; bed alone
  presses the bed). If the two sides' cases contradict, this ruling SUPERSEDES RULE 3c for
  this one function and goes on the 11c carry list as a RECORDED DECISION, never a
  take-ours. WHY: a placed station (laden_hearth, masters_field_forge, an apex feast)
  despawns on a timer and is the thing the player just walked to, while a farm bed is
  permanent world furniture that is still there next press, which is the same logic the
  shipped order already uses for corpses over nodes. REJECTED: leaving the priority to
  whichever side's cases happen to survive.
- PARK, by taking either side purely to unblock, and then LIST BY NAME: the 27 REGEN
  files (24 resolved-i18n bundles, translation_keys.generated.ts, content.generated.ts,
  ci_shard_weights.generated.json), the 67 goldens under tests/parity/golden/, the 17
  ART_CENSUS files, and the 13 COUNT_PIN files (world_api_parity, command_schema,
  monolith_budget, deeds_content, deed_i18n, deeds_view, reliquary_content, profile_page,
  professions_blob_growth, professions_blob_roundtrip, material_taxonomy,
  material_taxonomy_bootstrap, recipe_economy). Parked means PARKED: no regeneration, no
  re-record, no pin bump, no ceiling raise in this phase. Every one of them is 11d's, and
  running a generator before 11c is final means running it twice.
- Two parked files carry a SETTLED answer (2026-08-20), so park them TOWARD it instead of
  re-opening the question.
  tests/release_v039_icon_art.test.ts: "deleted or moved" was a false dichotomy. Farming
  REFACTORED the assertion into the ART-SUBJECT SPLIT (artSubjectHotbarItemIds, live minus
  ITEM_ART_PENDING, .toHaveLength(72), plus a new pendingHotbarItemIds .toHaveLength(16),
  plus a both-directions debt check), which is the rule scripts/item_art_audit.mjs already
  applies, against masterwrought's single liveHotbarItemIds .toHaveLength(75). Park on
  FARMING's refactored form and record the verdict REFACTORED, NOT DELETED, so nothing lands
  on the deletion list; 11d re-derives both literals on the merged tree (art-subject to 75,
  the three painted phase-10 role foods, and pending to the merged count). WHY: farming's
  form is strictly more general, because it polices the debt in BOTH directions, so a stale
  pending entry that has since shipped art also fails. REJECTED: masterwrought's
  single-literal form, which discards a real guard.
  scripts/ci_shard_weights.generated.json: the resolution is a KEY UNION with the NEWER
  __provenance block and a re-derived `files`, and a union covering under 95 percent of test
  files reds the gate. Hand-written weights are refused; the fix is a fresh CI harvest. 11d
  executes it.
- Confirm both new goldens arrive and are registered: rift_clear_rewards.json (ours) and
  farming_session.json (theirs). tests/parity/scenarios.ts does not conflict, so both
  scenario appends auto-merge; verify by count that every golden file has a scenario row
  and every scenario row has a golden file, and that each new scenario lands in a parity
  shard.

2.5 THE DOCUMENTATION MOVE (SERIAL, after the four slices rejoin, its own commit). It
edits files four other slices touch, so it never runs in parallel with them.
- git mv docs/farming docs/prd/masterwrought/farming. Use git mv so rename detection
  keeps the history walkable. SETTLED 2026-08-20, the same rule as the item-row count:
  DERIVE the tracked-file count with `git ls-tree -r --name-only` and record the number you
  actually find in the report and the ledger. One reading says 36 at the farming tip and an
  earlier one says 34; trust NEITHER, and if the derived count disagrees with a plan
  literal, say so explicitly. WHY: the doc-move commit and the acceptance both key off this
  number, and a count nobody re-derived is the pin trap. REJECTED: adopting 34 or 36.
- Scripted rewrite of the in-packet path string: 303 occurrences of `docs/farming/`
  across the packet's own files at planning time. One commit, nothing else in it,
  verified by a grep returning zero.
- The out-of-packet citations. The plan enumerates five across four files; a repo-wide
  grep at planning time finds NINE occurrences across SIX files, and the extra ones are
  real: tests/monolith_budget.test.ts (deviation (an)), tests/item_art_consistency.test.ts
  (twice, deviation (al)), tests/mob_portrait_source_manifest.test.ts (deviation (al)),
  docs/design/deeds.md:204, src/sim/content/zone1.ts:918 (a SHIPPED-SOURCE comment that
  no lane listed), and tests/farming_asset_manifest.test.ts (:3 and :167 comments plus
  the needle below). Re-run the grep yourself; the enumeration is a starting set.
- THE NEEDLE. tests/farming_asset_manifest.test.ts carries
  `expect(manifestText.includes('docs/farming/')).toBe(false)`, whose whole job is to
  keep docs/design/farming-asset-manifest.json from pointing into a packet that teardown
  may delete. After the move that string can never appear, so the guard passes VACUOUSLY
  and silently stops guarding. Re-point the needle at `docs/prd/masterwrought/`, the
  merged packet root, in the SAME commit, and PROVE it still bites: temporarily inject
  the new path into the manifest text fixture, watch the assertion go red, revert the
  injection. A guard you did not watch fail is not a guard.
- Leave docs/design/farming-asset-manifest.json exactly where it is. Its entire purpose
  is surviving teardown; moving it under the packet destroys the reason it exists.
- Do NOT touch tests/farming_asset_manifest.test.ts's journeyEvidence assertion. It is
  the one tracked reference keeping the farming-phase-13 screenshot cone row in
  tests/ci_workflow.test.ts's referenced corpus.
- Rewrite ONLY forward-looking assertions; past-tense execution records stay VERBATIM.
  147 D22 mentions across 33 files are mostly correct history ("delivery followed D22:
  no push, no PR") and are not swept. The forward-looking set is small and enumerable:
  the moved README's "Working agreements" paragraph (wrong on all four claims now), the
  farming implementation-plan's "Delivery:" bullet (already dead under D22, doubly wrong
  now, delete it), that plan's "Packet teardown" section, farming/state.md lines 23 and
  56 ("Current phase ... local-only per D22"), and the handoff row saying the journey
  script joins the gate at go-public. Two banners plus four section rewrites cover the
  rest.
- A dated banner at the head of the moved README recording old path, new path, and date,
  saying plainly that this was a RENAME and not a revision, so old transcripts and
  hashes stay resolvable. This is the one place `docs/farming/` may still appear.

INVARIANTS IN PLAY: a true merge commit, never a squash or rebase; ZERO design change
(no aura id, magnitude, duration, ladder rung, recipe bill, price, charge count, or deed
renown moves in this phase); no generator run; no golden re-recorded; no count pin
bumped; no monolith ceiling touched; src/sim/ stays DOM-free and deterministic
(tests/architecture.test.ts is the exit gate, not a formality); every player-visible
string still a t() key; explicit paths on every git command, never git add -A.

Out of scope, and say so in the report rather than doing it quietly: the well-fed and
feast reconciliation (11c owns it, including retiring `wellfed?`, wiring
src/sim/wellfed.ts, and the ladder re-tune); any golden re-record, generator run, count
pin, ceiling, or frozen SHA (11d owns them, including the export and symbol census);
any new content (settled 2026-08-20: the seed faucet and the crop roster are 11e's, the
recipe_seasoned_stock bill is 11g's, and the apex feasts are 11k's). If a conflict cannot be
resolved without making one of those calls, park it under
RULE 3c and hand it up. Parking is the correct answer here; deciding is not.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
- npx tsc --noEmit MUST be clean. It is about 2 seconds repo-wide; run it after every
  slice rejoins, not once at the end.
- npx vitest run tests/architecture.test.ts MUST be green (sim purity, the pure-module
  allowlist, no wall-clock or Math.random under src/sim/).
- npx vitest run tests/ci_workflow.test.ts: the sparse-cone union. Neither
  tests/ci_workflow.test.ts nor .github/workflows/ci.yml conflicted (the two packets'
  rows sit in alphabetically disjoint regions), so the union should land automatically.
  VERIFY IT ANYWAY: 13 merged rows, nine farming (farming/, farming-phase-01, -05, -07,
  -08, -09, -09b, -12, -13) and four masterwrought (masterwrought-phase06-tomes,
  -phase07, -phase08-qa, -phase10-qa), present in the test literal AND in all five
  workflow blocks, byte-identical, or the block-equality assertion fires.
- npx vitest run tests/farming_asset_manifest.test.ts after the doc move.
- Then run the full suite ONCE, capture the complete red list, and CLASSIFY every red
  into 11c-owned, 11d-owned, or a defect of this phase. A red you cannot name is a
  defect of this phase and blocks the exit.
- npm run ci:changed (changed files only, never a whole-repo biome write).
- Review Dispatch Matrix rows this diff matches: architecture-reviewer (src/sim/ changes,
  determinism, the SimContext seam), cross-platform-sync (src/world_api/** gains
  src/world_api/farming.ts as a clean add, plus SimEvent and matcher changes),
  frontend-seam-reviewer (src/ui/, src/render/, the hud.ts resolution),
  privacy-security-review (server/ files arrive: character_professions.ts,
  farming_commands.ts, heavy_self.ts, character_blob_size.ts, db.ts, main.ts),
  migration-safety (server/db.ts and the characters.state JSONB path farming writes
  farmPlots into), qa-checklist LAST. Prompt every reviewer for COVERAGE, not filtering
  (report every issue including low-severity and uncertain ones; ranking happens later),
  hard 30-tool-call budget, report first. Apply ALL findings: blocking, should-fix, and
  nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies on every commit, no session trailers):
- The merge commit itself, carrying every conflicted-file resolution. A merge commit
  cannot be split, so make the resolution decisions BEFORE running git merge, not during.
  Body: the farming tip hash, the six class counts, the three rules, and the four
  decisions from STEP 0.
- fix(sim): port the farming item rows onto the ItemDef union
- refactor(ui): resolve the farming extractions against the in-place edits
- docs(masterwrought): re-home the farming packet under docs/prd/masterwrought
- docs(masterwrought): record the absorb, the F axis, and the decisions index
The merge commit is EXPECTED to be tsc-red on its own; the exit criterion binds the
phase TIP, not each intermediate commit. Record that in the ledger rather than hiding it
by folding the fixups into the merge.

STEP 5 - ACCEPTANCE:
- [ ] The four settled decisions (2026-08-20) copied into the state.md Phase 11b ledger as
      ANSWERED, with no gate in this file left reading confirm-at-STEP-0
- [ ] A true merge commit: git log --merges -1 shows two parents, the second being the
      farming tip, and git merge-base --is-ancestor origin/feature/farming-plan HEAD
      exits 0. No squash, no rebase, no cherry-pick.
- [ ] Every conflicted path resolved and classified; the six class counts recorded, and
      every deviation from 27/67/17/13/14/22 explained by the release sync.
- [ ] RULE 1 applied to all seven append-only tables; DEED_ORDER[len-1] is
      'prog_farming_100'; no committed masterwrought row moved position.
- [ ] RULE 2 discharged: the diff-filter=A set enumerated, every candidate diffed against
      its old home, zero duplicate definitions, and the SUNDER arm present in
      src/ui/cast_display_name.ts.
- [ ] RULE 3 discharged: imports unioned, independent additions composed, and every
      mutually exclusive hunk taking ours WITH its theirs-side text recorded whole on the
      11c carry list.
- [ ] feast? on OtherItemDef; wellfed? on FoodItemDef beside wellFed?; every incoming row
      in src/sim/content/items.ts checked against its union member, with the real count
      DERIVED by kind and recorded, and any disagreement with a plan literal named in the
      report.
- [ ] docs/farming moved with git mv; the tracked-file count DERIVED with git ls-tree and
      recorded; zero `docs/farming/` anywhere except the moved README's dated banner; the
      asset-manifest needle re-pointed AND watched to fail.
- [ ] tests/release_v039_icon_art.test.ts parked on FARMING's art-subject split form, with
      the verdict REFACTORED, NOT DELETED recorded for 11d and nothing added to the
      deletion list for it.
- [ ] The interaction-priority decision recorded (placed station first, farm bed
      immediately below) with both directions pinned in tests/nearby_interaction.test.ts.
- [ ] The merged professions-overview sentence recorded as OWED TO 11c, and "four
      gathering" still shipped here by design rather than by omission.
- [ ] The delegated-rulings block migrated into farming/state.md's handoff table in the
      doc-move commit, with a one-line pointer left behind in masterwrought/state.md.
- [ ] npx tsc --noEmit clean; tests/architecture.test.ts green; tests/ci_workflow.test.ts
      green with 13 merged cone rows.
- [ ] Every remaining red NAMED, LISTED, and assigned to 11c or 11d in the state.md
      Phase 11b ledger.
- [ ] Zero design change: a reviewer can read the diff and find no moved number.

STEP 6 - DOCS:
- masterwrought/state.md: the Phase 11b ledger (the four decisions settled 2026-08-20,
  copied from the delegated-rulings block rather than re-derived,
  the farming tip hash, the six class counts, the three rules as applied, the 11c carry
  list whole, the named red list with owners, and the three-literal baseline capture from
  0c). Append the delivery-contract amendment to the Delivery contract section, and
  rewrite the stale "Current phase" header to name BOTH absorbed states so a fresh
  session cannot load half the world.
- masterwrought/progress.md: 16 farming rows as F01..F14 (with F06b and F09b), status
  "complete (absorbed)", Record column pointing at farming/progress.md. Do NOT copy
  farming's row bodies; several are 1000 to 2000 characters of dense verdict text. Fix
  the stale "11 QA | pending" row in the same pass. Exactly ONE new Notes entry for the
  absorb: the farming tip, the conflict count and classes, the F-axis mapping, which
  contracts were superseded, and where the farming record lives.
- masterwrought/decisions-index.md, new, about 30 lines: R<n> is a masterwrought ruling,
  D<n> a farming decision, (x) a farming deviation letter (next is (cb), never
  resequenced), F<nn> a farming phase; where each lives; and the "never renumber, amend
  in place" rule.
- farming/state.md: the D22 SUPERSEDED banner immediately above the D22 bullet, body kept
  verbatim; the two "Current phase ... local-only per D22" headers rewritten; and a
  pointer recording that its 117-row handoff table is now the merged packet's ONE
  open-item collection point, with masterwrought's open decisions appended at the END,
  never interleaved.
- THE DELEGATED-RULINGS MIGRATION, settled 2026-08-20, and it rides the DOC-MOVE commit
  rather than this step's own commit. The delegated answers currently live as a dated block
  at the END of masterwrought/state.md, because farming/state.md did not exist when they
  were written. In the SAME commit as the git mv, MIGRATE that block into
  farming/state.md's handoff table, converting each row into that file's status vocabulary
  (open ruling-owed, closed-by-X), leave a ONE-LINE pointer behind in
  masterwrought/state.md, and state the append convention there in the same edit:
  masterwrought's open items append at the END of the handoff table, never interleaved.
  WHY: every phase from 11e onward is told to read farming's OPEN list, so the answers need
  exactly one home, and the commit that CREATES the destination is the only place the
  migration costs nothing. REJECTED: leaving the block in two places, or authoring it twice.
- Memory note for anything that surprised you, especially a new member of the
  extraction-versus-in-place class.

STEP 7 - REPORT: phase status; the farming tip merged; the six class counts predicted
versus observed; the RULE 2 enumeration and what it found; the ItemDef port's real row
count; the doc-move grep results; tsc and architecture results; the named red list with
owners; reviewer verdicts; and a handoff line for Phase 11b QA.

STOPPING RULES: decisions 1 through 4 are SETTLED (2026-08-20) and are never a stop; stop
only if the state.md delegated-rulings block is missing or disagrees with 0a, because that
means two records exist and one of them is wrong. Stop if a conflict cannot be resolved
without choosing a magnitude, an aura id, or a bill (park it under RULE 3c and hand it up,
that is not a stop, but a case the rules do not cover IS); the interaction priority is no
longer such a case, since the placed station wins and the farm bed sits immediately below; if the merge would have to be a squash or
a rebase to proceed; if tsc cannot be made clean without moving a shipped number; if the
conflicted-path count deviates in a way the release sync does not explain; or if the
RULE 2 sweep finds a copied body that differs from its old home in a way that is not
obviously ours' edit (a third variant means someone edited both, and that is a design
question, not a merge).
```
