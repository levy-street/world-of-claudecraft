# Phase 11o QA: verify the leveling crafter

### QA Starter Prompt
```
This is Phase 11o QA of the Masterwrought feature. Phase 11o re-leveled the crafted
rung-50/75 rares into their natural character-level bands, built the engineering on-ramp
(a tier-0 hoe re-tier plus a part and a gadget), and retired the skill-150 tool tier to
125. The audit's centre of gravity is the DERIVATION CHAIN: recipe.level feeds derived
item level feeds requiredLevel, so a re-level that looks local can move an item's gate, a
pinned ilvl, or the level-20 shelf, and the phase's whole R5-safety claim rests on that
shelf not moving.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: prove the wearability windows are genuinely met and the level-20 shelf genuinely
unmoved, prove the on-ramp is reachable by simulation rather than by reading, prove the
re-tier's side effects were measured, and prove nothing outside the authorized surface
moved (no magnitude anywhere).

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11o committed); SYNC RELEASE per the
canonical workflow. Memory scan: the test-pin trap index (READ before judging any pin),
new-item-content-hidden-obligations, item-art-ownership-batch-xor-entries. Read state.md
rows 117 to 120 FIRST: this audit judges the code against the settled rulings, and a
code-versus-ruling mismatch is blocking on its own.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (the Phase 11o ledger, rows 117 to 120,
the prediction-versus-observation table), progress.md's 11o row,
phase-11o-leveling-crafter.md (what was promised), the git diff against the phase-start
commit, plus src/sim/item_level.ts, src/sim/item_level_req.ts,
src/sim/professions/crafting.ts, content/recipes.ts and the touched defs.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):

Derivation agent (the finding most likely to be missed): independently recompute the
derived item level and requiredLevel for EVERY output whose recipe.level moved, from
item_level.ts and item_level_req.ts, and compare against the ledger's
prediction-versus-observation table; any unpredicted movement is a finding. Then sweep the
WHOLE catalog for requiredLevel or derived-ilvl movement OUTSIDE the touched set (the
shelf claim is an every-item claim, not a touched-item claim): diff the derived values
tree-wide against the phase-start commit. Any moved apex, heroic, raid or vendor value is
BLOCKING.

Scope-completeness agent: re-derive the re-level scope from ALL_RECIPES (equippable
outputs at skillReq 50 and 75) and require the touched set to match it exactly, minus the
recorded shared-def skip list, with each skip verified against a real second source. A
missed row means the window claim is false for its craft; an extra row means a consumable
or intermediate moved that the ruling excluded.

On-ramp agent (simulate, do not read): walk the unattuned path by the real gates: at
engineering 0, which rows does teachTierMet admit, what does each cost, is each row's
recipe tier inside the unattuned gain ceiling, and how many crafts reach 25. Then the
attuned 0-to-75 walk with no grandfathered tier-3 craft. Verify the part's chassis row is
ADDED (the pre-phase bill is intact underneath it), the bill re-checked gold-negative, and
the masterwork material-tier delta the ledger records matches an independent recompute.
Verify the gadget against R14 (no proc, no combat effect) and R23 (no vendor twin) by
sweep, not by its comment.

Re-tier agent: confirm the three tool rows sit at 125 with everything else about them
byte-identical; recompute the three recorded side effects (cast band, masterwork
tiersAboveRecipe delta for a capped major, non-major gain still zero) and compare against
the ledger; confirm both header lessons carry the dated amendment and still state the
rule for NEW rows; confirm PRE_TRAINING_RECIPE_IDS is untouched; confirm
docs/design/professions.md's family reading is amended with the date and full R-numbers.

Invariant-decisiveness agent: prove the new tests by MUTATION, restored after each: raise
one re-leveled recipe.level back to 20 and require tests/crafted_wearability.test.ts to
red naming the row; move one apex output's derived gate in a scratch copy and require the
shelf pin to red; remove the unattuned-learnable row and require the on-ramp test to red.
Then the classic vacuous-pin traps: constant-self-comparison (the wearability test must
not import the new levels and compare them to themselves), empty-set passes, one-direction
checks.

Obligations agent: both new ids through the full checklist (R15 registry verdicts with
naming-audit.md evidence, ITEM_ART_PENDING rows with exactly one mapping.json owner, M16
where the guard says wordy, wiki regen fresh, ids append-only under the three-tier
ordering rule, no deed and no Reliquary page with both verdicts WRITTEN), and the
no-magnitude sweep: no stat, armor, dps, potion, food or aura value anywhere in the diff.

Dispatch per the Review Dispatch Matrix: content-obligations-reviewer,
test-coverage-auditor, then qa-checklist LAST. Do NOT dispatch cross-platform-sync or
architecture-reviewer unless the diff actually grew sim behavior, a facet member or a wire
field, in which case that is itself the finding.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 11o
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 11o QA row), state.md drift (any prediction, window or
side-effect number that moved under the fix round), memory notes for any reusable trap.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the mutation
kill table itemized, the shelf verdict stated plainly (moved or unmoved, with the sweep
that proves it), and the handoff to Phase 12. Follow-ups are CUT-or-fix decisions, never
future-PR items.
```
