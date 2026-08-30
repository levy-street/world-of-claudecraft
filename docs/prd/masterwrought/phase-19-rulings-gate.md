# Phase 19: The rulings gate (every open maintainer decision, answered and executed)

Appended 2026-08-30 under ruling qr-18-REOPEN. The packet's residual list is two kinds of
item: work a session can do (Phase 18) and decisions only the maintainer can make (this
phase). Phase 19 opens on ONE complete decision table, takes the maintainer's answers
in-session, executes every ruling, and records each where it stands. No decision is
guessed; no row closes without a ruling id.

## The decision table (FINALIZED by the Phase 18 QA; the seed rows below are the known set)

Every row: the question, the options, a price per option, a recommendation, the
authority row it closes. The Phase 18 QA replaces this seed with the derived, complete
table before this phase runs.

| # | Decision | Where it stands today | Options (priced by the 18 QA) |
|---|---|---|---|
| 1 | The commission minimum-fee floor: (a) mechanics (escrow at open / transfer at delivery / display-only), (b) basis (UNBIND_FEE ladder / buyValue fraction / flat) | PARKED, Phase 14 ledger + handoff row 128 | to be priced |
| 2 | Ruling 135 p13-OPEN-RELIQUARY: does a player-named legendary INSTANCE warrant an instance-keyed Reliquary page | RECORDED undecided, farming/state.md rulings block | to be priced |
| 3 | The THIRTEEN standing items (state.md): scroll/elixir 15c parity; RULE 2's value-half reading; the inherited stale-client window; 11h's two deviations (ratify or revert); 11i's session cap 15 s to 16 s; prog_first_harvest's 13 catches; the apex hoe channel (the Decision-A contradiction); the shipped-id golden policy; Decision D's band scope; the reworded wiki keys' stale fills (folded into the Phase 20 fill unless ruled re-keyed); col_junk_drawer's three of margin; zone 1 carries no poor mob drop | OPEN, each with its ledger derivation | to be priced, one row each |
| 4 | Every farming handoff-table row still in the open-family and handed-to-maintainer classes (re-derive the live set from the table's text; 44 non-fill rows at the Phase 17 close), including the tuning reads ((bs) waiver cadence, feast tuning, seed-back rates, watch and compost fees, tonic, dish curve points, crop durations, name lore passes, hoe names) and the standing deviations ((a), (w), (al), (ap), (bb), (be), (bg), (bh)) | OPEN in farming/state.md | to be priced, one row each |
| 5 | The feast per-area placement cap (a value and a scope: per cell or per zone) | Phase 17 hot-path read | to be priced |
| 6 | The nonce fence's missing expiry term (keep suspend-first, or add the term) | Phase 13 QA recorded read | to be priced |
| 7 | Alchemy has no repeatable band-3 recipe (author one, or accept the gap) | Phase 15 recorded read | to be priced |
| 8 | The apex weapon rung sits +1 over Greater (a demand risk under R21: tune, or accept) | power-verification.md section 14 | to be priced |
| 9 | qr-GRAY's row wording is measurably false as written (reword the row, or rule the measurement) | Phase 15 recorded read | to be priced |
| 10 | The two consistency reads: fine farm produce reads Material while ore/log/herb fine grades read Fine Material; the nameplate_canvas ratchet row on an upstream-owned line | recorded, unnumbered | to be priced |
| 11 | The zone-celebration fan-out shape, IF Phase 18's measurement recorded a refusal | Phase 18 ledger | to be priced |
| 12 | R5 on the merged world (the eighth v0.41.0 sync moved the fixture surface AND the hit table: all four baseline kits re-rated under the Crucible hit rebalance c920f39c85, WAR_BIS 355 to 165 hit, ROGUE_BIS 190 to 120, CASTER_BIS 160 to 50, the ramp ABOVE_LEVEL_MISS_PCT [0,2.5,14,21] to [0,2.5,8,14] so the merged needs read 130/190; the tank baseline 3332 to 3532 health under the legendary retune 4ed7a279b4): re-measure the record on the merged catalog (re-opens R5 under the four rulings' own conditions, and the re-measure must ALSO settle the target set: the existing two protected assets, heroic Nythraxis and S-rift, or an added Ignivar Crucible profile), or ratify the record as a measurement of the pre-raid catalog and retire the nine expected-fail pins | state.md, the eighth-sync AMENDED block in the Phase 15 ledger; the nine it.fails pins in r5_envelope_probe / masterwrought_budget / dev_bis_gear / server pbe_boost | to be priced |
| 13 | The apex tier's placement against the Crucible raid tier (the raid catalog out-scores every apex piece on bestEpicGearFor and the chest lead measures -1 against the ratified cap of 2), INCLUDING the staged Crucible crafted fast-follow (docs/prd/ignivar-raid-professions.md + src/sim/content/crucible_professions.ts, PR 3704: crafted epics at ilvl 37 with skill-100 floors and a crafted non-masterwrought legendary, prospectively contradicting the packet's crafted-ceiling premises): re-tier the apex pieces above the Crucible tier, accept the raid tier above apex and amend the power placement (then rescope the ilvl-31 pin and the R3 sub-cap wording to the masterwrought family explicitly), or fold into row 12's re-measure; and rule whether the fast-follow inherits the masterwrought flag and cap | same block; tests/dev_bis_gear.test.ts and the masterwrought_budget lead-cap arm; the rogue identity re-anchor awaits the same authority's confirmation | to be priced |
| 14 | The twin complement rule against the retuned references (forgefold_legguards and spiritweld_girdle now duplicate their reference drop's crit 40): re-complement the twins against the retuned references (an R5-surface def edit), or amend the complement rule | same block; the two MERGE_INHERITED_TWIN_DUPLICATES rows in tests/masterwrought_budget.test.ts | to be priced |
| 15 | REF_ARMOR (2861) against the raid-era live max-armour kit (4085 after the Crucible plate; the pre-raid gap was about a hundred points): raise the calibration constant and re-derive every difficulty floor, or keep it and record the widened gap as the model's stated conservatism | power-verification.md section 14 (the REF_ARMOR read); tests/heroic_difficulty_floors.test.ts re-pin note | to be priced |
| 16 | The Crucible GEAR tier's sundering admission (the tier scope of R1's "of the tier"): the raid-sourced Crucible gear epics currently feed sundered essence the way every raid gear epic does, which widens the R4/R9 material economy the packet balanced against the pre-raid raid tier; admit them (status quo), exclude them by tier, or fold into row 12's re-measure. The NON-gear widening (sigils, the lastflame core) is already closed in-repo by the gear allowlist, pinned | state.md, the eighth-sync AMENDED block (the sundering record); src/sim/professions/sundering.ts isSunderable; tests/masterwrought_materials.test.ts, the eighth-sync gear-allowlist arm | to be priced |

### Starter Prompt
```
STANDING DELIVERY RULE (unchanged): NO push, NO PR, NO teardown. LOCAL ONLY.
This is Phase 19 of the Masterwrought feature: the rulings gate. Model: xhigh effort.
ULTRACODE: yes for the execution and review halves; the decision half is a
conversation with the maintainer and runs in the main loop.

WORKTREE GUARD (FIRST): run pwd. If not in /Users/fernando/Documents/wocc-masterwrought,
switch NOW with EnterWorktree (path: /Users/fernando/Documents/wocc-masterwrought). If it
refuses, STOP.

STEP 0 - PRE-FLIGHT: git status clean at the Phase 18 QA close; the newest
origin/release/** re-resolved by version sort and merged with the release-merge-audit if
it moved (riders as in Phase 18). Memory scan as in Phase 18.

STEP 1 - THE TABLE: load the FINALIZED decision table from this file (the Phase 18 QA
wrote it). Verify it is complete against the live ledgers with one Explore sweep (any
open decision missing from the table is added before STEP 2, priced the same way). Then
STOP and present the whole table to the maintainer in ONE message, every row with its
options, prices, and the recommendation. Do not proceed until every row has an answer
in the maintainer's own words (a row may be answered "defer past the PR": that is a
ruling too, recorded as such with the maintainer's reason).

STEP 2 - EXECUTE EVERY RULING, one commit per ruling cluster: content tunes carry their
same-change obligations (wiki regen, deed and reliquary pins, art parks, non-Latin fills,
census rows, the R5 surface untouched unless the ruling names it, in which case the
harness re-cut and the record amendment ride the same commit); mechanics rulings carry
their tests (sim and server always) and their reviewers per the Review Dispatch Matrix;
every ruling is RECORDED where the open row stands (a dated RULED line with the ruling
id qr-19-<slug>, the maintainer's answer quoted in substance, the executing commit), the
handoff table row's status flipped, the decisions index updated if a namespace moved.

STEP 3 - REVIEW: every execution unit gets its domain reviewer and a fresh reader; all
findings applied; the fix round re-read fresh; qa-checklist LAST. The QA twin is folded
INTO this phase by decision (the 11b-qa-GATE-9 precedent): the executions are small,
each is reviewed twice here, and Phase 20's re-close is the independent backstop.

STEP 4 - VALIDATION: tsc, the affected suites, architecture and monolith guards, the
census (RESULT PASS, exit captured without a pipe), ci:changed after the last commit,
then node scripts/gate_select.mjs on the committed tree, then the full npm run gate in
the background (pg armed) judged by exit code AND markers.

STEP 5 - DOCS: progress.md Phase 19 row; the Phase 19 ledger in state.md (the table as
answered, every ruling id, every executing commit, the JUDGED list); the handoff table's
open classes should now hold ONLY the fill rows and ip-17-PUSH; if anything else remains
open, it carries a ruling id that says why.

STOPPING RULES: no ruling is inferred from silence; a ruling that contradicts a ratified
R5 row is an escalation, not an execution; a ruling that needs a value the maintainer did
not give goes back to the maintainer in the same session; any red gate step; NO push, NO
PR, NO teardown.

REPORT: the answered table, every ruling's id and commit, the review record, the gate
results, and NEXT = Phase 20 (phase-20-release-fill-and-reclose.md, FRESH session).
```
