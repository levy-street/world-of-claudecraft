# Phase 05 QA: verify the jewelcrafting base catalog

### QA Starter Prompt (AMENDED AT PHASE 05 BUILD, 2026-08-10: diff range, rulings
### queue, blast-radius sweep, and the session-restart guard added; original steps kept)
```
This is Phase 05 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. ULTRACODE: yes (the QA fan-out runs as a
Workflow). Worktree: ~/Documents/wocc-masterwrought (branch feature/masterwrought).

Goal: audit the Phase 05 catalog before the intermediates (phase 07) and apex jewelry
(phase 09) build on the profession. Audit emphasis (the phase's QA focus): no rating
allocations beyond same-band vendor jewelry (R14); itemization coverage tests;
profession XP curve sanity on the new rungs.
AMENDED AT PHASE 05 BUILD: the build landed at 58dc6a5629, six commits on top of the
release-sync merge c17acd0a08; audit git diff c17acd0a08..58dc6a5629. Two review
rounds already ran IN the build session and every finding is applied; this QA
re-judges the whole diff fresh, INCLUDING those fix rounds (a fix round is itself
lightly-reviewed code), and takes the queued rulings.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.
AMENDED: a mid-session restart (a usage-limit resume) silently RESETS the shell cwd to
the launch directory while absolute-path edits keep landing in the worktree; after ANY
restart, re-run pwd and re-issue EnterWorktree before any relative-path command
(memory: session-restart-resets-worktree-cwd).

STEP 0 - PRE-FLIGHT: git status clean (Phase 05 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), content/economy pin gotchas,
session-restart-resets-worktree-cwd, the Masterwrought packet note.
AMENDED: if the merge touches anything in the stills bundle graph the portrait source
manifest goes stale; when --check says stale, re-mint via the receipt flow and move the
accepted-art digest pin (the Phase 05 ledger records the exact commands). NEVER pipe
gate or test runs through tail; it masks the exit code (the build hit this twice).

STEP 1 - LOAD CONTEXT (Explore agent; planning docs never in the main loop): state.md
(R10, R13, R14, R15, the recorded station decision, power placement) and the ENTIRE
"Phase 05 ledger" section (serial decisions, PREMISE CORRECTION, EXECUTION RECORD, both
REVIEW ROUND records, RULINGS WANTED, RELEASE-FILL OBLIGATIONS, QA FOLLOW-UPS);
progress.md Phase 05 row; phase-05-jewelcrafting-base.md (what was promised); the full
diff c17acd0a08..58dc6a5629 and every touched file.

STEP 2 - RULINGS (present to Fernando unless he answered inline above; record outcomes
in state.md): (1) the quality ladder ships uncommon(0)/uncommon(25)/rare(50) against
the spec's common/uncommon/rare gloss (common jewelry is statless by formula; the
profession_items doctrine and classic-era precedent both back the deviation);
(2) the Trapper pair's default hobby flipped to jewelcrafting
(correct-by-derivation, pinned; the desirability is the call); (3) author
prog_jewelcrafting_50 and prog_grandmaster_jewelcrafting now, or keep them deferred
with the archetype pairs (the hold is AUTHORING, not mechanics; enchanting shipped its
pair in the same no-pair-quest position). Still open from Phase 04: heroic-raid epics
are NOT sunderable (decide before phase 12 prices Perfecting).

STEP 3 - QA AUDIT (ultracode Workflow fan-out, COVERAGE not filtering):
Budget agent: recompute every new item's budget from primaryStatBudget at the
recipe-derived ilvl by hand for a sample of each rung and confirm EXACT equality;
confirm NO rating allocation on any base-rung piece beyond the same-band vendor jewelry
(R14: pure primary stats + stamina); the recipe_economy exception list is still EMPTY.
Coverage agent: itemization coverage tests pass and actually see the new pieces; every
recipe's inputs exist and resolve as SHIPPED (the "salvage gems" class does not exist;
the ledger's premise correction reads it as the dust/essence ladder; the rung-50 4th
line is iron solder, which REPLACED a fine-grade line that violated the material-grades
shared-pool invariant, so confirm no recipe anywhere pairs a base material with its
fine grade); every recipe has a trainer row with a tier-table fee; every item has an
icon row and an English name; wiki regenerated and fresh.
Progression agent: profession XP curve sanity on the new rungs (skill-up pacing 0 to 50
comparable to a model profession; no rung starves or trivializes skill gain); the
station decision recorded in state.md matches what the code does. The rung-0 dust round
trip is INTENDED material-positive (the classic shuttle-craft dust economy; gold is the
sink): verify the gold-negative half holds and record, never "fix".
Test-decisiveness agent: pins fail on regression (would inflating one budget by a point
fail a test? would a rating stat on a base ring?); no constant-self-comparison pins;
new ids append-only against the frozen-id golden. ALSO judge the build's own new pins
(jewelcrafting_catalog, jewelcrafting_flow, the dev-kit jewelry picks, the Trapper
pin, the reliquary masterworkByCraft derivation guard, the train_view 20-id list).
BLAST-RADIUS agent (ADDED; the build's coverage lesson was that the phase spec's suite
list covered what the change BUILT, not what it TOUCHED): sweep the suites outside the
phase list that the catalog moved (train_view, dev_kit, material_hint_view,
material_grades, material_profession_affinity + bootstrap + hint_view,
reliquary_content, reliquary_state, profile_page, character_sheet, deeds_view,
deed_i18n, guide) and hunt for any OTHER surface that derives behavior from
ALL_RECIPES or ITEMS and silently changed (the defaultHobbyForPair and dev-kit flips
were found exactly this way; find the next one).
Dispatch per the Review Dispatch Matrix: frontend-seam-reviewer,
content-obligations-reviewer (purpose-built for a content diff of this shape), plus
qa-checklist (phase-completion gate); architecture-reviewer only if the sync brought
sim LOGIC changes (Phase 05 itself added none).

STEP 4 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 05
validation set PLUS the blast-radius suites; separate fix commits with explicit paths
and bodies, no session trailers. The fix round is itself unreviewed code: have a fresh
reviewer pass over the fix diff. Close with node scripts/gate_select.mjs at the
committed tip, exit code unmasked.

STEP 5 - DOCS: progress.md (Phase 05 QA row), state.md drift (ruling outcomes, ledger
corrections), memory notes.

STEP 6 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the ruling
outcomes, handoff to Phase 06 (inscription base catalog; phase 06 records its OWN
station decision). Follow-ups are CUT-or-fix decisions, never future-PR items.

STOPPING RULES: stop and ask if a ruling reversal would require re-authoring shipped
content ids (ids are frozen; display and data retunes only), or if the release sync
brings a conflicting jewelcrafting change.
```
