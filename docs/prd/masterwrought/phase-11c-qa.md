# Phase 11c QA: verify the food and feast reconciliation

### QA Starter Prompt
```
This is Phase 11c QA of the Masterwrought feature. Phase 11c resolved the only place in the
farming absorb where two shipped behaviors genuinely contradict, so this audit is about
completeness of the unification and about one silent-defect class, not about style.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: prove that exactly ONE Well Fed system exists in the merged tree, that the feast bite
mints the same aura a bagged dish does, that the ladder leaves R5's 21-stamina kit intact,
and that every red left standing is one of the three the phase NAMED for 11d, before 11d
re-mints the artifacts that would otherwise catch a mistake here.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11c committed); SYNC RELEASE per the canonical
workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory scan: the
test-pin trap index (READ before judging any pin), the i18n reword-staleness and
locale-overlay entries, the parity-golden gotchas. Read the recorded decision 2 answer in
state.md FIRST: this audit judges the code against the answer that was given, not against
the recommended default, and a code-versus-ruling mismatch is blocking on its own.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (the Phase 11c ledger, R5 and the Power
placement numbers), progress.md Phase 11c row, phase-11c-food-and-feast.md (what was
promised, including the three NAMED reds and the predicted farming_session composition),
farming/state.md (D15 as amended and the closed "Well-fed ladder magnitudes" row), the git
diff against the phase-start commit, and every file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):

Unification agent: exactly one well-fed field in the tree and it is FoodItemDef.wellFed;
grep the whole repo for the lowercase `wellfed` spelling and for the `wellfed_` id prefix and
account for every hit as historical ledger prose, never live code, tests, or generator source;
exactly one module mints the aura and exactly one aura id exists; the clear-then-grant order
is the one in the tree; WELL_FED_AURA_ID is exported and every non-pin site references it
instead of re-typing the literal; the src/sim/wellfed.ts NAMESPACE header describes the rule
that now ships and not the retired one (a stale load-bearing comment is a finding, not a nit);
the retired inline block in combat/auras.ts and the retired wellFedTooltipLines in
elixir_tooltip_view.ts are GONE, not merely unreferenced.

Carried-payload agent (adversarial; this is the phase's highest-value guard and it gets
mutated, not eyeballed): enumerate EVERY Consuming construction site in the merged tree and
classify each as a real writer that must carry the payload or a named dev-scenario writer that
must not; then mutate. Delete the wellFed carry from the feast bite and confirm a test goes
RED; if the phase took the builder route, delete the carry from the builder and confirm the
same. A green suite after either mutation is a BLOCKING finding, because that is exactly the
defect the phase existed to prevent. Then confirm the identity pin asserts the whole aura
record (id, kind, value, duration, name, school, sourceId) and drives the real tick path
(place, bite, ride the drain), not a direct call into the mint.

Ladder agent: recompute the ladder from the LIVE catalog rather than from the ledger, and
confirm the apex strictly dominates every non-apex well-fed food on magnitude AND duration;
confirm the endgame kit is still flask 15 plus food 6 equals 21 stamina and say the number out
loud in the report; confirm the apex duration is DERIVED in the pin (entry duration plus the
elixir ladder's own duration step) and not merely pasted; confirm the shippedCeiling arm still
derives 980 from the live table and was not weakened into a literal while it was being edited;
confirm the new domination arm sweeps the live catalog so a fifth dish authored later reds the
day it ships. Under the CUT answer instead: confirm all four payloads are gone, the apex is
untouched at 6/600, and the entry-rung case is byte-identical to its pre-phase form.

Copy and i18n agent: compose the real item tooltip for one farming dish and one apex role food
and COUNT the well-fed description lines; two is a blocking regression, and the pin that
catches it must exist. Confirm exactly one tooltip key pair survives, that its English states
both the completion trigger and the one-at-a-time rule, that the surviving view supplies
exactly that key's placeholder set, and that the retired pair is gone from the catalog AND
from all five non-Latin overlays with nothing orphaned. Confirm the cooking route body reword
landed, that "feast" in it now names only the real mechanic, and that the row is flagged for
the release-tier reword fill. Confirm farming's farm route sentence about "a later patch's
deeper fields" was NOT touched here (it belongs to 11e). Confirm the S3 guard is green and
that no new player-visible string bypassed t().

Test-decisiveness agent: the WELL_FED_AURA_ID identity pin compares against a hard-coded
literal, never against the constant it imports (constant-self-comparison); the
flask_consumables ctx.applyAura patch is re-pointed at the new call site AND its order claim
would actually fail if the two lines were swapped (mutate mentally, then for real); the
aura_icon_view case was INVERTED to assert the painted well_fed recipe, not deleted; the two
new exclusivity cases would fail under a per-kind namespace regression, in both orders; the
Laden Hearth pairing pin would fail if recipe_harvest_feast's stationType or the
cooking-to-kitchens mapping moved; every rewritten farming case still proves something (the
retired guard cases were REPLACED by a narrowing pin, not silently dropped).

Named-reds agent: run the full listed validation set and confirm the ONLY reds are the three
the phase named (guide freshness, the resolved i18n bundles plus translation_keys, and
farming_session). Any fourth red is a finding. Confirm nothing was regenerated or re-recorded
early to make a real red look like a named one: no generated artifact and no parity golden may
appear in this phase's diff. Confirm the predicted farming_session composition is written down
in state.md in the form 11d can check it against, including the load-bearing clause that the
aura row must still be PRESENT in the feast-wellfed-minted frame.

Cleanup agent: no dead code and no unused imports left by either deletion (the ITEMS import in
wellfed.ts, the elixir view's export, the second hud import); sim purity intact; no item id
added, removed or renamed; the diff carries no unrelated refactor; the two dev-scenario meal
writers are named in the ledger so a later reader does not "fix" them.

Dispatch per the Review Dispatch Matrix: architecture-reviewer, cross-platform-sync,
frontend-seam-reviewer, content-obligations-reviewer, plus qa-checklist (phase-completion
gate). COVERAGE prompts.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 11c validation
set including the parity suite; separate fix commits with explicit paths. The fix round is
itself unreviewed code: have a fresh reviewer pass over the fix diff. A fix that changes a
power number re-opens decision 2 and stops the phase instead.

STEP 4 - DOCS: progress.md (Phase 11c QA row), state.md drift (any ladder, seam or pin detail
that moved during the fix round, and the final predicted farming_session composition),
farming/state.md if the D15 amendment or the closed ladder row needs correcting, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the three named
reds restated verbatim for 11d, and the handoff to Phase 11d. Follow-ups are CUT-or-fix
decisions, never future-PR items.
```
