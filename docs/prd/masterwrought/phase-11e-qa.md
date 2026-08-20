# Phase 11e QA: verify the mastery curve, the crop roster, and the seed gate

### QA Starter Prompt
```
This is Phase 11e QA of the Masterwrought feature. Phase 11e re-tuned a shipped progression
curve, grew a persisted content catalog, and discharged the packet's hardest blocker, so this
audit has three jobs: prove the curve is DERIVED rather than felt, prove the slower curve
bought pacing and not obligation, and prove every new id and every un-dormed row is complete
end to end.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: a fresh reader must be able to rebuild the gain curve from docs alone and get the same
four literals; the anti-chore contract must be intact and pinned, not asserted; every new crop
must have a faucet and a consumer; the art and i18n obligations must be discharged in this
change; and no golden may have moved that should not have.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11e committed); SYNC RELEASE per the canonical
workflow (fetch, discover the newest origin/release/** by version sort, merge, run
release-merge-audit). Memory scan: the test-pin trap index (READ before judging any pin),
new-item-content-hidden-obligations, item-art-ownership-batch-xor-entries, the i18n
reword-staleness entry, the parity-golden gotchas, and the gate-env DATABASE_URL entry.

PRECONDITION, SETTLED 2026-08-20: all six 11e decisions (A to F) are ANSWERED and are
written into the packet's open-item record BEFORE this session starts, in state.md's
"Decisions closed 2026-08-20 (the full delegation)" section, which 11b STEP 6 migrates into
farming/state.md's handoff table. READ those recorded answers FIRST. If the record is
missing, STOP rather than auditing against defaults. This audit judges the code against the
RECORDED answers and never against the recommended defaults either file used to carry, and a
code-versus-ruling mismatch is blocking on its own. WHY: every gate in this packet shipped
with a recommended default, so an auditor reading defaults instead of rulings would silently
bless a session that took an alternative; recording first is what makes this a comparison
rather than a re-derivation. The same precondition binds 11f-QA, 11h-QA, 11i-QA, 11j-QA, and
11k-QA.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (the "Decisions closed 2026-08-20 (the full
delegation)" section, the Phase 11e ledger, the CALENDAR MODEL section, the six decisions as
EXECUTED against that record, the naming registry rows); progress.md Phase 11e row;
phase-11e-mastery-curve.md (what was promised, including the predicted pin table and the
predicted farming_session composition); farming/state.md (D5 and D11 as amended, GATE 1's
closure, the closed OPEN rows, the anti-chore contract in farming/qa-checklist.md); the git
diff against the phase-start commit; and every file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):

Model-reproducibility agent (this is the phase's headline claim and it gets REBUILT, not
read). Working from state.md ALONE, with no source file open, rebuild the calendar model:
inputs, reference-farmer assumption, per-band table, days-per-band arithmetic, total
harvests. Then open the tree and require the four shipped FARMING_GAIN_SCHEDULE literals to
be exactly what your rebuild produces. A model that cannot be rebuilt from the doc is a
BLOCKING finding even if the curve is defensible, because reproducibility IS the
deliverable. The rebuild must land on DECISION A's SETTLED target: about 10 weeks (70 to 75
days) for the reference farmer, with a floor of about 5 weeks at maximum dedication (all 23
beds, two visits, about 44 successful harvests a day). A derived span materially under a
month is BLOCKING: it re-opens DECISION A rather than shipping. Then trace every input to a
real symbol (bed counts to FARM_PATCHES, durations to the farm_crops literals, survival to
farmSurvivalChance and FARM_SURVIVAL_AT_GATE, teaching ceilings to
farmingTeachingCeilingFor, the band gate to farmCropSkillThreshold) and flag any number that
appears only in prose. Confirm the withered arm still grants NO proficiency, since the whole
model multiplies by survival on that basis. Confirm the derivation TEST exists and would
actually fail: mutate one gain literal and require a red.

Curve-safety agent. The belowProficiency column and the row COUNT are byte-identical to
their pre-phase values, which DECISION A froze at 25 / 50 / 75 / 100 (the column is the
teaching-ceiling source through FARMING_GAIN_SCHEDULE[min(tier, length - 1)], so a moved
boundary silently re-grays crops for every farmer alive); the tier-ceiling derivation pin is
green WITHOUT having been edited; farmingHarvestGainAt still zeroes at or past the ceiling;
the gains are monotonically non-increasing and all strictly positive (a zero row would stall
the ladder before the cap); every literal is exactly representable in binary floating point
and the accumulation pin uses strict equality, never toBeCloseTo (the shipped 0.1 and 0.02
were not representable, so this is a real fix and it must be pinned as one); no rng draw was
added anywhere, and the plant two-draw and harvest draw-count contracts are byte-identical.

Anti-chore agent (adversarial). Each of the five rows of farming/qa-checklist.md's anti-chore
audit has a pin or a stated proof, and each proof is against the AS-SHIPPED curve rather than
against intent. Then hunt for the failure mode the phase exists to prevent: grep the whole
farming surface for anything that could turn pacing into obligation (a daily reset, a decay or
rot path, a streak, a rested or catch-up bonus, a login-gated grant, a timer that punishes a
late return) and account for every hit. Confirm the late-harvest pin drives the REAL harvest
path with two clocks and asserts equal proficiency, not merely equal yield. Confirm the
structural pin (the schedule is read at the grant site and nowhere else) strips comments before
asserting on source text, so a comment naming a call cannot satisfy it. Mutate: make the grant
read elapsed time and require a red.

Roster agent. Twelve new ids exactly (four seeds, four produce, four fine twins), per
DECISION B as SETTLED; six is the REJECTED +2 answer, so a diff carrying it is a
code-versus-ruling mismatch and blocking on its own. Check the ruled COMPOSITION too,
because 11h GATE B reads it: exactly ONE of the two new tier-3 crops is a LEAF, and no tier
repeats a plant class. Every gate is DERIVED from tier: no crop carries a hand-set skill
number, the two-independent-25s binding pin is green, and the survival ramp and the plant
gate still agree. All four durations within each tier are distinct, inside the D5 band, and
none undercuts the tier's previous minimum (a shorter upper-tier crop would raise the
harvests-per-day ceiling and undo the tune through the back door: check this by arithmetic,
not by reading the banner). No new price point: every new sellValue and buyValue is a value
its tier already used. Every new crop has a FAUCET (a vendor row with a positive buyValue)
and a CONSUMER (an added reagent row on a shipped bill), and no forbidden bill was touched:
recipe_highwatch_barley_porridge, recipe_evergarden_braised_greens, recipe_harvest_feast,
recipe_seasoned_stock (11g owns it under its DECISION C), and every masterwrought apex bill
must be diff-clean. The four bills 11e was allowed to touch are the settled set:
recipe_highwatch_barley_bannock, recipe_highwatch_gourd_soup,
recipe_evergarden_sunmelon_tart, and recipe_evergarden_harvest_platter. Confirm the consumer
edits ADDED rows and removed or reduced nothing (R18), and that the affected dishes'
reachability did not move (they already required a crop of that tier). Confirm no shipped
crop id was renamed or retired, since crop ids are persisted save keys and FARM_CROP_IDS
drops what it does not carry.

GATE 1 agent. All eight tier 3 and 4 seeds carry the positive buyValue DECISION D settled
(32 at tier 3, 64 at tier 4: the four-times-sell convention plus the two-times bootstrap
premium), derived from the merged sellValues with its arithmetic printed at the row, and no
row renders and then refuses (the D11 dead-row trap: buy each one through the real path, not
by reading the def). The three formerly dormant recipes complete END TO END from a fresh
character; prog_farming_100 and feat_book_complete are reachable; the docs/design/deeds.md
waiver is CLOSED with its date and closing phase; the self-clearing honesty arm in
tests/deeds_content.test.ts SELF-CLEARED rather than being deleted, and its inverted
assertions still read so that green means "earnable" and never "the arm went vacuous" (this
one gets mutated: break a purchase surface and require a red). NEVER_STOCKED lost exactly
the four shipped seed literals, gained none of the new ones, and its size pin plus its
FARM_RECIPES companion were re-derived with the per-table non-vacuity arms intact. Each
per-farmer vendor-walk width pin moved by exactly the number of rows added. The guide no
longer advertises a dish with no seed source, and the wiki regen is fresh.

Tool-effect agent. The advertised-slot copy names farming, and the pin backing it asserts
the POLICY (slotToolEffectRefused for the farming arm) rather than the copy against itself.
The src/ui/tool_effect_tooltip.ts header no longer states the closed set wrongly. DECISION C
is SETTLED at +1, so verify it landed where it belongs: in farming's own
quantity-to-bonusPicks mapping, with TOOL_EFFECTS.makers_charm.bonus UNCHANGED at 2 (a
change there silently re-tunes mining, logging, and herbalism); the existing Gatherer's
Cache identity arms are still green, which they would be either way, so confirm a NEW arm
exists that proves the cap actually bites for makers_charm and mutate it to be sure. The
bonus tooltip line is honest about what a hoe pays (docs/design/tooltip-writing.md): compose
the real card and read it. The reworded key is recorded on the release-tier fill worklist,
the resolved bundles were regenerated rather than hand-edited, and the reword-staleness trap
is noted for the locales whose fills now read as filled while their English moved.

Obligations agent. ITEM_ART_PENDING is exactly 56 (the merged 44 plus this phase's 12), and
the number was PREDICTED before it was observed, not pasted after: check the ledger for the
prediction. PARK is settled for the whole packet, so confirm no committed WebP art was
attempted and that each new id has exactly ONE art owner (the pending row), never the batch
form and an entries row at once. Every new id has its own procedural icon recipe and
resolves to no static url, and none has a public/ui/items/mapping.json entry it should not
own. M16 non-Latin fills exist for every wordy new English name, in this change. Wiki regen
is fresh and tests/guide.test.ts is green. The four settled sweep verdicts are each WRITTEN
DOWN and each matches the ruling: Reliquary no page, no Book of Deeds record beyond DECISION
E, no new work-order rows (a flat WORK_ORDER_PAYOUT_FRACTION of 0.5 against top-of-curve
produce mints copper), no new market filter chip, and nothing owed in
src/ui/world_entity_i18n.ts. A sweep that was assumed rather than run is a finding.
tests/recipe_economy.test.ts's two sorted literal pins were RECOMPUTED from the merged
ALL_RECIPES, never hand-merged, and the non-vacuity floor beneath the membership pin moved
with the set. Ids are append-only. DECISION E took the deed (category 'collection', renown
5, no title, no border), so check it as shipped content and not as an option: its mark
namespace is REGISTERED in VISITED_MARK_NAMESPACES in src/sim/deeds.ts and a save/load round
trip proves the mark survives (an unregistered namespace serializes fine and is dropped on
load, which is bitten twice in this codebase already), the deed appended after farming's
block under the three-tier ordering rule, and the deed totals and the deed_i18n manifest
were re-derived by prediction rather than pasted.

Golden and baseline agent. Exactly one golden moved (farming_session), its re-record is its own
isolated commit, and its composition matches the phase's written prediction: draw count and draw
digest UNCHANGED (this phase added no draw), with only the sampled farming proficiency moving
and by exactly the new gain. Zero other goldens moved, and no generated artifact was hand-edited.
IWorld parity totals, the command schema counts, the delta-key count, and the SimEvent set are
unmoved, and each was predicted before it was run. No monolith ceiling moved, and none was
raised.

Test-decisiveness agent. Every moved pin was predicted then observed (read the ledger table and
spot-check three rows by recomputation). No pin compares a constant against the constant it
imports. The duration pins are literals, not derivations of the table they guard. The new
suites fail on regression: mutate one gain literal, one crop tier, one seed buyValue, and the
farming effect cap, and require a named red for each. Confirm no test was weakened while it was
being edited (a literal quietly replaced by a derivation from the value under test is the trap).
vitest -t is a regex: check any narrowed run in the phase report actually selected what it
claimed.

Cleanup agent. No dead code, no unused imports, sim purity intact
(tests/architecture.test.ts green), no unrelated refactor in the diff, every TUNING banner
accurate to the value beside it and none still saying "provisional" for a number this phase
settled, and every source or test comment citing a packet ruling number written in the form
DECISION F settled, "masterwrought R<n>" IN FULL and never bare, since R17 to R23 already
mean professions-tuning rulings in shipped source. A bare packet R-number in src/, server/,
tests/, or a CLAUDE.md is a FINDING, not a nit. decisions-index.md must be untouched by this
phase: 11d owns the professions-tuning namespace row, so confirm the row exists and that 11e
neither edited nor duplicated it.

Dispatch per the Review Dispatch Matrix: architecture-reviewer, content-obligations-reviewer,
frontend-seam-reviewer, migration-safety, plus qa-checklist (phase-completion gate). COVERAGE
prompts.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 11e
validation set including the full suite and the parity suite; separate fix commits with
explicit paths. The fix round is itself unreviewed code: have a fresh reviewer pass over the
fix diff. A fix that changes a gain literal must re-derive the whole curve from the model
and land inside DECISION A's settled span; a fix that would move a crop gate, a seed price,
the roster size or its composition, or any other recorded ruling STOPS the phase and is
written up for the maintainer, never taken in session. A fix that requires a second golden
re-record is a STOP.

STEP 4 - DOCS: progress.md (Phase 11e QA row), state.md drift (any model input, curve literal,
crop row, price, or pin that moved during the fix round, and the final predicted-versus-observed
pin table), farming/state.md if a closed OPEN row or an amended D5 or D11 line needs correcting,
docs/design/deeds.md if the waiver closure text moved, memory notes for anything that surprised
you.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, a decisions
table showing each of the six recorded rulings beside what actually shipped, the rebuilt
model table beside the shipped curve so the two are visibly the same, the GATE 1 end-to-end
evidence, and the handoff to Phase 11f with the exact numbers it inherits (the roster ids,
the seed prices, and the gain curve). Follow-ups are CUT-or-fix decisions, never future-PR
items.

```
