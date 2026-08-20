# Phase 11f QA: verify farming's drop economy

### QA Starter Prompt
```
This is Phase 11f QA of the Masterwrought feature. Phase 11f re-channelled shipped content:
it moved six farming recipes off the trainer and onto pattern drops, climbed their rungs to
75 and 100 (nothing farming owns reaches 125), appended entries to three loot pillars,
layered drop and marks channels on top of the seed bootstrap 11e already landed, and added
an rng draw at harvest. Two properties make this audit strict. First, the phase's whole
thesis is that NO machinery was invented, and a thesis is exactly the kind of claim that is
easy to assert and easy to violate in one line. Second, a
re-channelled recipe that loses its last live channel is INVISIBLE to a content assertion
and visible only to a reachability walk.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: prove the machinery is untouched, that patterns and recipes are referentially exact in
both directions, that no recipe became unobtainable, that the loot appends did not perturb a
single existing draw, that 11e's GATE 1 bootstrap is intact and was not re-authored or
re-priced here, that the seed drop arm is additive rather than compulsory, and that every
tier gate refuses correctly, before Phase 12 builds on the merged tree.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11f committed). SYNC RELEASE per the canonical
workflow (fetch, discover the newest origin/release/** by version sort, merge,
release-merge-audit).
THE RECORDED-ANSWERS PRECONDITION, and it binds this audit before anything else runs: all
five of 11f's decisions were SETTLED 2026-08-20 and are recorded in
docs/prd/masterwrought/state.md under "Decisions closed 2026-08-20 (the full delegation)"
(migrated by 11b STEP 6 into farming/state.md's handoff table). Read the RECORDED answers
FIRST and judge the code against them, NEVER against a recommended default left standing in
any phase file. A code-versus-ruling mismatch is BLOCKING on its own, whatever else is
green. If the recorded block is missing, STOP: an auditor reading defaults instead of
rulings silently blesses a session that took an alternative.
Memory scan: the test-pin trap index (READ it before judging ANY pin),
new-item-content-hidden-obligations, item-art-ownership-batch-xor-entries, the i18n
reword-staleness entry, the parity and golden entries, and the standing "apply ALL findings"
rule.

STEP 1 - LOAD CONTEXT (Explore agent): docs/prd/masterwrought/state.md (R8, R13, R14, R15,
R17, R18, R19, R20, the Phase 11 channel-assignment ledger, and the Phase 11f ledger as
written); farming/state.md (D8, D11, D13, D17, D24, MAINTAINER GATES item 1, deviations
(aj), (bo), (bs), (bz), (ca), and the OPEN list); progress.md's Phase 11f row;
phase-11f-drop-economy.md (what was promised, including its five SETTLED decisions, the
REJECTED lines recorded beside them, and its REJECTION LIST); git diff against the
phase-start commit; and every file the diff touched, plus
src/sim/professions/pattern_items.ts, training.ts, wheel.ts, and crafting.ts to confirm
their diffs are EMPTY.

STEP 2 - QA AUDIT (parallel agents; prompt for COVERAGE, not filtering):

No-new-machinery agent: the diffs of src/sim/professions/pattern_items.ts, training.ts,
wheel.ts, and crafting.ts are byte-EMPTY. resolvePatternLearn's four arms and their deny
ORDER are unchanged, so a double click still resolves already_known before any other arm and
never spends a second copy. teachTierMet is still the ONE tier authority, so a pattern and a
trainer can never disagree about who may learn a row. No new ItemKind, no new use-dispatch
arm, no farming-only learn path, no "seed recipe" item. If the phase reached for any of
these, say so in one line at the top of the report: it is the phase thesis failing and it
outranks every other finding.

Referential and reachability agent, the highest-value lane here: every farming pattern
teaches a recipe that exists on the merged ALL_RECIPES, and every farm recipe whose
acquisition includes 'drop' has exactly ONE pattern. No orphan in either direction. Then the
part a content assertion cannot see: walk REACHABILITY. Every flipped row is reachable
through at least one LIVE channel, meaning the hosting boss, rift pool, or vendor row
actually exists in shipped content and is actually reached in play (check the rift C-arm
early return, the raid difficulty the parity scenario kills, and any table gated behind
content a player cannot enter). Every unflipped row is still on a real trainer's teach list
and did not fall off it when the rung moved. NO RECIPE BECAME UNOBTAINABLE is the verdict
this agent owns, and it is proven by a walk, not by an existence check.

Tier-gate agent: the gates REFUSE correctly and refuse without consuming. Drive every arm
against the real code path: a cooking-75 pattern at cooking 50 refuses on tier; a
cooking-100 pattern at cooking 75 refuses on tier; a player who has never cooked refuses on
profession before the tier arm can fire; an already-known row refuses first of all; and every
refusal leaves the item in the bags. Confirm the band math is the SHARED one
(tierForSkill over TIER_SKILL_STEP) and that nothing in this phase introduced a second tier
rule. Confirm the flipped rows' skillReq values are real rungs and that no row landed on a
skill value the band math does not admit. Confirm the settled band table exactly: 0:4, 25:3,
50:1, 75:2, 100:4, and NO farm row at 125.

Loot draw-order agent: FIRST, confirm the rift rank residual actually closed before or as
11f's first commit, so the appended rift draw sits in a stream the rank goldens cover: the
rank parameter on the riftClearRewards factory, the three SCENARIOS appends at baseLevel
20/22/28, and their coverage arm and minted goldens all exist. An append into an uncovered
stream is a finding even when every other arm is green. THEN: every entry is a genuine
APPEND. Diff the raid table, the rift draw
sequence, and the dungeon tables entry by entry against the phase-start commit and prove
nothing above the new rows moved, nothing was reordered, and no existing rollGroup changed
membership. The rift list is exported SORTED and the rng.int pick indexes it, so a re-sort is
a determinism change: confirm the sort is the one the code indexes. Then the decisive check:
the parity suite is green, and the ONLY golden that moved is farming_session, in its own
isolated commit, with the machine classification recorded and nothing else in that commit. A
golden that moved and was not predicted is a determinism regression, not a re-record.

Determinism agent: the new harvest draw is UNCONDITIONAL and CONTIGUOUS at exactly one
documented position, spent on every resolving arm including withered and the defensive
retired-crop arm, and read only when the golden roll won. The DRAW CONTRACT header was
restated WHOLE, not amended in one line, and it now reads: plant 2, tier 1/2 harvest 2,
tier 3/4 harvest 3, every deny arm 0, convert_husks 0, expiry 0, login 0, save and load 0,
the tick sweep 0. Verify each of those numerically against the code, not against the comment.
Confirm the KNOBS RULE still holds (no knob combination changes the draw count) and that the
new draw would actually FAIL the parity scenario on a position change: mutate mentally, and
where cheap, mutate for real. No Math.random, no wall clock, nothing outside ctx.rng.

Seed channel agent: this phase did NOT own GATE 1 (11e did), so this lane audits two things
instead. FIRST, that 11e's bootstrap survived intact: the three formerly dormant rows
(highwatch_barley_porridge, evergarden_braised_greens, recipe_harvest_feast) are still
completable by a PLAYER through the VENDOR path alone, proven by a test that buys a seed,
plants, harvests, learns the pattern, and crafts, rather than by a content assertion that
the row exists; both parked deeds (prog_farming_100 and the transitive feat_book_complete)
are still earnable; the (bs) waiver in docs/design/deeds.md is still CLOSED against 11e and
was not re-closed here; and the git diff shows ZERO edits to any farmer vendorItems row.
SECOND, that the added drop and marks channels really yield the seeds. THE VACUITY READ, the
highest-value check in this lane: the self-clearing honesty arm over the purchase surfaces
must be green because the rows are earnable, never because the arm stopped asserting
anything; re-read its inverted assertions line by line and mutate one to prove it still
bites. Confirm NEVER_STOCKED
lost exactly the upper-tier seeds 11e stocked (four on the shipped roster, EIGHT after
11e-D-B's roster growth, derived from FARM_CROPS and never from a count in a document) and
kept its per-table non-vacuity arm. This phase adds no copper vendor row at all, so D11's
dead-row trap applies to 11e's rows, which this phase only re-reads; what this phase DID add
is quartermaster stock, and every one of those rows carries the settled 12-mark price.

Identity and anti-compulsion agent: the seeds dropping from endgame content did NOT make
farming's top tiers conditional on raiding. The pin exists and bites: a character who never
enters a raid, a rift, or a heroic five-man can still obtain all four seeds, through the
farmer counters and the market. Seeds and produce are kind 'junk' and market-listable; the
tier-1 and tier-2 seeds are still vendor-stocked; the seed-back rolls are unchanged and still
the thrift path; no daily or weekly grant was minted anywhere. R17 is asserted as a SWEEP over
the merged ALL_RECIPES (no farm produce, fine twin, or seed in recipe_quickening_catalyst, in
any Perfecting material, or in any gear intermediate), and R18's additive rule holds: farming
rows were ADDED beside herb rows, never substituted for them, so herbalism lost nothing.

Economy and derivation agent: BOTH sorted literals in tests/recipe_economy.test.ts were
RECOMPUTED from the merged ALL_RECIPES, never hand-merged, and the non-vacuity floor beneath
the membership pin survived and moved with the set. The vendor-fed derivation was re-run
AFTER the four seeds gained buyValues, not before. Every seed price states its convention
(the four-times-sell convention, tier-3 seeds selling at 4 and tier-4 at 8) and its premium
separately, and a bought seed is clearly dearer than a seed-back seed. Every farming mark
price is the shipped RING point 12, for all six patterns and every upper-tier seed; NO
farming row sits at the 16 (neck) point, because no farming pattern reaches rung 125; and no
third point was minted. Every pattern's QUALITY derives from its taught row's OUTPUT quality
rather than being uniform, and every pattern's sellValue is the shipped uniform point of
100. The golden bonus weights were DERIVED from the shipped rare-event cadence, and the
recorded pattern-arm rate is strictly SLOWER than the quartermaster route, which is DECISION
D's binding acceptance criterion: check the arithmetic, not the claim. The re-tiered
rows are still gold-negative with the arithmetic printed and independently re-derivable, and
the (bz) whole-list invariant still holds for every one of them. WORK_ORDER_PAYOUT_FRACTION
and the produce work orders are untouched.

Power-and-scope agent: magnitudes are FROZEN. No foodHp value, well-fed magnitude, duration,
aura id, charge count, or output quality moved, and the 11c-owned files' diffs are empty.
R14 holds (no new proc effect, no new aura id). R9 holds (no oncePerDay stamp, no daily of
any kind added). The rung climb moved itemLevelBudget and level for the climbing rows: confirm
the phase ASSERTED rather than assumed that a food output carries no slot and is therefore not
item-level eligible, and that no item-level budget pin moved silently. Confirm the settled
rung placement landed as ruled: recipe_harvest_feast at cooking 100 and NOT 125, no farm row
on cooking 125, and NO second cooking-125 capstone exception recorded anywhere. DECISION A
refused that exception as unnecessary, so a recorded exception is itself a finding, and so
is a feast that climbed past 100.

Surfaces and obligations agent (dispatch content-obligations-reviewer): the wiki source label
states BOTH channels for a pattern that drops AND sells on the quartermaster, the generator
change lands at the generator and not at the render site alone, and tests/guide.test.ts is
honest for all three cases (drop-only, vendor-only, both). The wiki was regenerated on the
merged tree and its freshness gate is green. Any dormancy-disclosure prose that is now false
was DELETED, not left standing. Every new item id carries committed WebP art or a row on the
MERGED ITEM_ART_PENDING allowlist with exactly one mapping.json owner (the batch-XOR rule),
and the park decision is recorded with its reason. M16 non-Latin fills for the wordy English
names landed IN THIS CHANGE. tests/shipped_item_ids.test.ts is append-only green. The naming
verdict is WRITTEN even though nothing new was coined, and the deed and Reliquary sweep
verdicts are written either way. Every i18n.catalog append sits in the right tier of the
ordering rule.

Test-decisiveness agent: every moved pin has a PREDICTED value beside its observed one. No
constant-self-comparison (a pin that computes both sides from the same expression proves
nothing), and the kind:'recipe' universe pin is the one most likely to have gone vacuous when
it became a union: read it line by line and confirm both directions still bite. The
band-completeness pin has BOTH arms and both bite: the exact derived map, and the
non-emptiness arm over bands 0 through 100, which fails when a band is emptied. The
referential pin fails in BOTH
directions. Negative arms exist per dimension (wrong craft, wrong tier, already known, wrong
farmer, out of range, missing reagent). Watch the known traps: vitest -t is a regex,
source-text pins are comment-gameable, and a pin re-derived from the same helper the code uses
is not a pin. Where a moved pin's title now describes the old composition (the heroic vendor
suite's title is the known one), confirm it was REWORDED and not left lying.

Cleanup agent: every packet R-number this phase wrote into src/, server/, tests/, or a
CLAUDE.md reads "masterwrought R<n>" IN FULL (the R17 and R18 sweeps are where this bites,
and a bare packet R-number in source is a finding, not a nit, because a bare R-number in
shipped source means the Professions 2.0 series). No dead code, no unused imports, sim
purity intact, no wall clock or
Math.random anywhere under src/sim/, no monolith ceiling raised, every comment beside a moved
number was AMENDED to match it (a stale comment beside a re-tiered row is this phase's most
likely residue), the REJECTION LIST is present in state.md so none of its items is
re-proposed, and the one farming OPEN row this phase closes ((aj)) is recorded as
closed-by-11f rather than left open. (bo) / GATE 1 and the fine-twin doctrine intersection
must still read closed-by-11e; a second closure stamp from this phase is a finding.

Dispatch per the Review Dispatch Matrix: content-obligations-reviewer (the whole content
diff), architecture-reviewer (the farming.ts draw site), frontend-seam-reviewer (the guide
source-label render and any catalog copy), cross-platform-sync only if a SimEvent, wire field,
or matcher rule moved, plus qa-checklist as the phase-completion gate. Skip
privacy-security-review, migration-safety, and database-performance-reviewer unless server/,
a SQL call site, or a characters.state serialize path was touched.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, AND nits). Rerun the Phase 11f
validation set INCLUDING the full suite (npx vitest run --maxWorkers=5) and the parity suite,
plus npm run ci:changed on the touched files. Separate fix commits with explicit paths and
bodies. If a fix moves a golden, it moves in its own isolated commit with the classification
recorded, exactly as the phase's own re-record did. The fix round is itself unreviewed code:
have a FRESH reviewer pass over the fix diff before closing. Read the gate LOG, not just its
exit code.

STEP 4 - DOCS: progress.md (the Phase 11f QA row), state.md drift (any rate, price, count,
quality, name, or pin that moved during the fix round, plus any settled decision the phase
executed differently from how it was ruled, which is a blocking finding and not a drift
note), farming/state.md's OPEN list if a row closed or opened here,
docs/design/deeds.md if the waiver closure needed correction, and memory notes for anything
that surprised you.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the
predicted-versus-observed pin table, an explicit one-line verdict on each of the six things
this QA owes (no machinery invented; pattern-and-recipe referential exactness; no recipe
unobtainable; loot draw-order parity held; 11e's GATE 1 bootstrap intact and untouched, with
the seed drop arm additive rather than compulsory; the tier gates refuse correctly), plus a
SEVENTH: every one of the five settled decisions was executed as ruled, named one by one
(the band-complete re-tier stopping at 100, the rung-derived channel rule, the unconditional
contiguous draw, the derived golden weights with the pattern arm slower than marks, and the
12-mark placement),
and the handoff to Phase 12. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
