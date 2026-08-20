# Phase 11i QA: verify the angler's endgame

### QA Starter Prompt
```
This is Phase 11i QA of the Masterwrought feature. Phase 11i widened a shipped ladder that
four surfaces read (the catch tables, the rod gate, the event union, the metrics label set)
and edited apex bills two other phases also edit. This audit is about two things: that
nothing an existing angler catches today moved, and that everything the phase added is
actually reachable.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: prove the nine shipped catch cells are byte identical, that no (proficiency, rod tier)
pair lost access, that every new band and every new id is reachable by a real player through
the shipped gates, that the chowder has fish in it, that fishing now stands in the endgame
band on its own account, and that the one parity golden this phase may move moved for the
predicted reason and nothing else did.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11i committed); SYNC RELEASE per the canonical
workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory scan: the
test-pin trap index (READ before judging any pin: predicted-then-observed,
constant-self-comparison, comment-gameable source pins), new-item-content-hidden-obligations,
item-art-ownership-batch-xor-entries, the i18n reword-staleness entry, and
observer-recorder-swallows-signature-drift (the telemetry label set is exactly that shape).
Read the recorded answers to GATES A to F in state.md FIRST (F is the pacing arm added by
the quality-review adoption pass, qr-11i-PACE at state.md row 121): this audit judges the
code
against the answers that were GIVEN, not against the recommended defaults, and a
code-versus-ruling mismatch is blocking on its own.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (the Phase 11i ledger, R8, R13, R14, R15,
R17, R18, R20, the naming registry), progress.md's 11i row, phase-11i-anglers-endgame.md
(what was promised, including the predicted moved-pair set and the predicted
professions_fishing_session composition), the git diff against the phase-start commit, and
every file the diff touched. Fetch the PRE-PHASE text of src/sim/content/items.ts's
FISHING_TABLES_BY_BAND from git so the byte-identical claim is checked against the real old
bytes and never against a restatement of them.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):

Shipped-cells agent (the phase's central promise, and it gets diffed, not read): pull the
pre-phase FISHING_TABLES_BY_BAND and compare bands 0, 1 and 2 cell by cell and row by row,
including row ORDER and the null row's position. Any weight, any row, any order change is
blocking. Confirm FISHING_TABLES is still the SAME object as FISHING_TABLES_BY_BAND[0] and
not a copy (mutate one and observe the other, or assert identity). Confirm every new cell
sums to exactly 100, carries a null row of weight at least 1, keeps empty-hook and grey-junk
non-increasing and the koi non-decreasing per band step, and keeps the aggregate cooking
catch non-decreasing. Then check the SCHEDULE, not just the cells: the extended rungs in
tests/fishing_zones.test.ts must DERIVE each new weight from the shortfall and surplus rule,
so a cell edited past the schedule reds there; if a new rung was written as a literal beside
the cell it describes, that is a constant-self-comparison and it is a finding.

Pacing agent (DECISION F, qr-11i-PACE): rebuild the casts-to-200 model from state.md ALONE
with no source file open (the 11e-qa reproducibility idiom), and require the four shipped
FISHING_GAIN_SCHEDULE literals to match the rebuild; confirm the band boundaries are
literally 50/100/150/200 unchanged, fishingTeachingCeilingFor's derivation untouched, the
zero-character-XP pin still standing, the target span honored (about 10 to 12 active hours
total, no band over a third), and the moved parity golden predicted before observed.
Mutate one gain literal and require the derivation test to red.

Ladder agent (adversarial; mutate, do not eyeball): confirm the exhaustive
proficiency-by-rod-tier walk exists, that it compares against a HARD-CODED pre-phase ladder
rather than importing the new constant, and that it would actually fail. Mutate: lower one
new threshold and confirm a test reds; raise one and confirm a test reds; swap two adjacent
thresholds and confirm a test reds. Confirm every new band REFUSES below its rod tier at each
rung (a tier-4 rod must not reach the band-5 table) and that the refusal rides
fishingRodBandFor and canGatherTier rather than a second gating rule invented for the new
bands. Confirm PROFICIENCY_BAND_THRESHOLDS is still literally [0, 100, 200] and that
gathering.ts's gather-cast duration for a land profession is unchanged at the same
proficiency values. Confirm the moved-pair set observed in the tree is EXACTLY the set the
ledger predicted, and that the ledger predicted it before it was observed.

Reachability and R20 agent: for every new item id, walk the real acquisition path end to end
and say whether a player can get it: the catch is in a table a reachable band draws; the rod
recipe is learnable (teachTierMet against a 125 cap, and remember there is no craft-time
skillReq admission gate, so LEARNING is the only barrier and skillReq 150 is unlearnable by
construction); the pattern is stocked or dropped where the ledger says; the dish's reagents
are all obtainable. Confirm NO recipe in the diff carries skillReq 150. Confirm every new
catch has at least one consumer and name it. Confirm recipe_sageleaf_chowder actually
contains a fish reagent, and that stonepot_stew and warspice_skewers carry the SAME fish
reagent at the same count. The three bills are NOT byte-identical overall and must not be:
11h differentiated them by crop and amended the uniform-bill comment in
APEX_CONSUMABLE_RECIPES' header. Confirm this phase left 11h's per-plate crop rows untouched,
and that the header comment still matches the rows under it. State the R20 property with row
ids: fishing present at skillReq 100 and above on its
own account rather than through a rod, and present in every 25-point band below.

Determinism and golden agent: confirm this phase added ZERO rng draws and that fishing.ts's
draw contract (one draw at cast start, one at a landed reel, none on any deny arm, none on
the codfather early return) is intact. Run the parity suite. professions_fishing_session is
the ONE golden this phase may legitimately move; confirm it moved for the predicted reason,
that the prediction was written down first, and that NO other golden and no generated
artifact appears in the diff. Then mutate: change the order of two rows inside a new cell and
confirm a test reds, because a table draw walks a running weight total and row order is
therefore behavior.

Wire and telemetry agent: confirm the band type is ONE exported type and that every site that
said `0 | 1 | 2` now says it (the four fishing SimEvent variants, effectiveFishingBand,
fishingRodBandFor, fishingBandLabel); a surviving literal union is a finding even where it
still compiles. Confirm server/fishing_telemetry.ts's FISHING_BANDS label set matches the new
band count, that BOTH stale comments were fixed (the "a fourth band is a design change that
should redden this pin" paragraph and the "zones x bands is 3 x 3" cardinality paragraph),
that the new bounded cardinality is stated in the ledger, and that the exporter's membership
guard still DROPS an off-list value rather than re-banding it. Confirm the rod-fee label
family still derives from ROD_RECIPES and that the new drop-taught rod recipe does not mint a
nonsensical fee series. Sweep the wire suites for shape changes nobody accounted for.

Frontend agent: compose the real rod tooltip for every shipped rod tier including the new
rung and read what it says. Confirm src/ui/gather_tool_tooltip.ts indexes the FISHING ladder
and not the shared one (at the top rung the shared array is shorter than the index, so the
pre-fix code returns undefined and the tooltip lies or blanks). Confirm the line states what
the rung actually unlocks per docs/design/tooltip-writing.md, that every player-visible string
goes through t(), and that any reword is flagged on the release-tier fill worklist with the
staleness trap named.

Content-obligations agent: every new item id has committed WebP art or exactly one row on the
merged ITEM_ART_PENDING allowlist with exactly one mapping.json owner (the batch-XOR rule);
M16 non-Latin fills for every wordy English name landed in THIS change; wiki regen ran and
tests/guide.test.ts freshness is green; deed count, Renown total, DEED_IMAGE_IDS and the
deed_i18n manifest were re-derived by prediction then observation rather than pasted from an
earlier ledger; luck-gated deeds carry zero Renown; the Reliquary and ZONE_FISH verdicts are
written down either way; every new proper noun is web-verified with its evidence in
naming-audit.md and its verdict in the registry, with the adversarial second pass actually run
on the fish and dish names; ids are append-only; and no generated file was hand-edited.

Guardrail agent: R18, every new catch is market-listable kind 'junk' with no soulbound and no
noMarketList flag, and every bill edit ADDED a row rather than substituting one (diff the
reagent lists against pre-phase and list any removal). R17, no new catch in
recipe_quickening_catalyst, in any gear intermediate, or in any Perfecting material, asserted
by a test rather than by inspection, with fishing's own tool ladder named as the recorded
exception. R14, no new aura id, no new proc effect, no new well-fed magnitude or duration
anywhere in the diff. R13, no craft maxSkill moved.

Test-decisiveness agent: every pinned behavior fails on regression, and prove it by mutation
rather than by reading. Specifically: the byte-identical cell pin fails if one shipped weight
moves by 1; the reachability pin fails if a recipe's skillReq is bumped to 150; the R20 pin
fails if the fish row is removed from the apex bills; the recipe_economy sorted literals were
RECOMPUTED from the tree and not hand-merged, with the non-vacuity floor intact; no pin
compares an imported constant against itself; and any test using vitest -t remembers that -t
is a regex.

Cleanup agent: no dead code and no unused imports left by the fishing_bands extraction; the
re-exports from fishing.ts actually have consumers or were removed; sim purity intact
(src/sim/ still free of DOM, Three and cross-layer imports); src/sim/professions/CLAUDE.md
updated; the two load-bearing items.ts comments (top-two-rungs and rod-rarity collinearity)
now describe what ships; no unrelated refactor rode along.

Dispatch per the Review Dispatch Matrix: content-obligations-reviewer, architecture-reviewer,
cross-platform-sync, privacy-security-review, frontend-seam-reviewer, plus qa-checklist
(phase-completion gate); migration-safety ONLY if a deed mark namespace was registered, in
which case also confirm the save/load round trip actually pins that the mark survives.
COVERAGE prompts.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 11i validation
set including the wire suites, the parity suite and the full suite; separate fix commits with
explicit paths. The fix round is itself unreviewed code: have a fresh reviewer pass over the
fix diff. A fix that would move a shipped cell, a well-fed magnitude, or an aura id re-opens
the gate that governs it and stops the phase instead.

STEP 4 - DOCS: progress.md (Phase 11i QA row), state.md drift (any threshold, cell, id,
naming verdict, deed total, cardinality or pin that moved during the fix round, and the final
observed moved-pair set), decisions-index.md if a gate answer was amended, memory notes (the
unlearnable-at-150 finding and anything the audit turned up that a later phase would trip on).

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the R20 statement
for fishing with its row ids, the predicted-versus-observed pin table, and the handoff to
Phase 11j including the apex-tool-family finding it inherits. Follow-ups are CUT-or-fix
decisions, never future-PR items.
```
